// Tests del importador de reseñas: automatiza el copiar/pegar manual.
//
// Cubre: (1) dedup por idExterno entre dos llamadas — el mismo lote
// procesado dos veces no reimporta ni recobra lo ya traído; (2) reseñas
// incompletas (sin estrellas o sin fecha) entran igual, marcadas — mismo
// criterio que RS.1; (3) un fallo del transporte no tumba nada: se convierte
// en `ImportadorError` con motivo comprensible; (4) persistencia en SQLite
// sobrevive a cerrar y reabrir el almacén (reinicio del proceso).

import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ImportadorReseñas,
  ImportadorError,
  AlmacenImportacionEnMemoria,
  AlmacenImportacionSqlite,
  crearTransporteImportacionReal,
  type ReseñaImportada,
  type TransporteImportacion,
} from "../src/importadorReseñas.js";

function transporteFalso(
  reseñas: ReseñaImportada[],
): { obtenerReseñas: (placeId: string) => Promise<ReseñaImportada[]>; _spy: ReturnType<typeof mock.fn> } {
  const fn = mock.fn((_placeId: string) => Promise.resolve(reseñas));
  return { obtenerReseñas: fn, _spy: fn };
}

const RESEÑA_1: ReseñaImportada = {
  idExterno: "r1",
  autor: "Marcela Ríos",
  texto: "La bandeja paisa estaba increíble.",
  estrellas: 5,
  fecha: "2026-09-01",
};
const RESEÑA_2: ReseñaImportada = {
  idExterno: "r2",
  autor: "Andrés Gómez",
  texto: "Esperamos 45 minutos.",
  estrellas: 2,
  fecha: "2026-09-02",
};
const RESEÑA_INCOMPLETA: ReseñaImportada = {
  idExterno: "r3",
  autor: "Jhon",
  texto: "Rico todo",
  estrellas: null,
  fecha: null,
};

describe("ImportadorReseñas — dedup por idExterno", () => {
  test("la primera importación trae todas como nuevas", async () => {
    const tf = transporteFalso([RESEÑA_1, RESEÑA_2]);
    const importador = new ImportadorReseñas(tf, new AlmacenImportacionEnMemoria());
    const resultado = await importador.importarNuevas("place-1");
    assert.equal(resultado.totalRecibidas, 2);
    assert.equal(resultado.nuevas, 2);
    assert.equal(resultado.yaVistas, 0);
    assert.equal(resultado.reseñas.length, 2);
    assert.equal(resultado.reseñas[0]!.autor, "Marcela Ríos");
  });

  test("la segunda importación con el mismo lote no reimporta nada", async () => {
    const tf = transporteFalso([RESEÑA_1, RESEÑA_2]);
    const almacen = new AlmacenImportacionEnMemoria();
    const importador = new ImportadorReseñas(tf, almacen);
    await importador.importarNuevas("place-1");
    const segunda = await importador.importarNuevas("place-1");
    assert.equal(segunda.totalRecibidas, 2);
    assert.equal(segunda.nuevas, 0);
    assert.equal(segunda.yaVistas, 2);
    assert.deepEqual(segunda.reseñas, []);
  });

  test("una tercera reseña nueva sobre el mismo negocio sí entra", async () => {
    const almacen = new AlmacenImportacionEnMemoria();
    const tf1 = transporteFalso([RESEÑA_1, RESEÑA_2]);
    const importador1 = new ImportadorReseñas(tf1, almacen);
    await importador1.importarNuevas("place-1");

    const tf2 = transporteFalso([RESEÑA_1, RESEÑA_2, RESEÑA_INCOMPLETA]);
    const importador2 = new ImportadorReseñas(tf2, almacen);
    const resultado = await importador2.importarNuevas("place-1");
    assert.equal(resultado.nuevas, 1);
    assert.equal(resultado.yaVistas, 2);
    assert.equal(resultado.reseñas[0]!.autor, "Jhon");
  });

  test("negocios distintos (place_id distinto) no comparten lo visto", async () => {
    const almacen = new AlmacenImportacionEnMemoria();
    const tf = transporteFalso([RESEÑA_1]);
    const importador = new ImportadorReseñas(tf, almacen);
    await importador.importarNuevas("place-1");
    const otroNegocio = await importador.importarNuevas("place-2");
    assert.equal(otroNegocio.nuevas, 1);
  });
});

describe("ImportadorReseñas — reseñas incompletas entran marcadas", () => {
  test("sin estrellas o sin fecha, la reseña entra con incompleta=true y motivo", async () => {
    const tf = transporteFalso([RESEÑA_INCOMPLETA]);
    const importador = new ImportadorReseñas(tf, new AlmacenImportacionEnMemoria());
    const resultado = await importador.importarNuevas("place-1");
    const [r] = resultado.reseñas;
    assert.equal(r!.incompleta, true);
    assert.ok(r!.motivo?.includes("sin estrellas"));
    assert.ok(r!.motivo?.includes("sin fecha"));
  });

  test("una reseña completa no se marca", async () => {
    const tf = transporteFalso([RESEÑA_1]);
    const importador = new ImportadorReseñas(tf, new AlmacenImportacionEnMemoria());
    const resultado = await importador.importarNuevas("place-1");
    assert.equal(resultado.reseñas[0]!.incompleta, false);
    assert.equal(resultado.reseñas[0]!.motivo, null);
  });
});

describe("ImportadorReseñas — fallo del transporte no tumba nada", () => {
  test("el transporte que lanza se convierte en ImportadorError con motivo legible", async () => {
    const tf: TransporteImportacion = {
      obtenerReseñas: () => Promise.reject(new Error("timeout de red")),
    };
    const importador = new ImportadorReseñas(tf, new AlmacenImportacionEnMemoria());
    await assert.rejects(
      () => importador.importarNuevas("place-1"),
      (error: unknown) => {
        assert.ok(error instanceof ImportadorError);
        assert.ok(error.message.includes("timeout de red"));
        return true;
      },
    );
  });

  test("un lote vacío del proveedor no es un error: cero reseñas nuevas", async () => {
    const tf = transporteFalso([]);
    const importador = new ImportadorReseñas(tf, new AlmacenImportacionEnMemoria());
    const resultado = await importador.importarNuevas("place-1");
    assert.equal(resultado.nuevas, 0);
    assert.deepEqual(resultado.reseñas, []);
  });
});

describe("AlmacenImportacionSqlite — sobrevive a reiniciar el proceso", () => {
  test("cerrar y reabrir el almacén conserva lo ya importado", async () => {
    const dir = mkdtempSync(join(tmpdir(), "importador-"));
    const ruta = join(dir, "importador.db");
    try {
      const almacen1 = new AlmacenImportacionSqlite(ruta);
      const tf1 = transporteFalso([RESEÑA_1, RESEÑA_2]);
      const importador1 = new ImportadorReseñas(tf1, almacen1);
      const primera = await importador1.importarNuevas("place-1");
      assert.equal(primera.nuevas, 2);
      almacen1.cerrar();

      const almacen2 = new AlmacenImportacionSqlite(ruta);
      const tf2 = transporteFalso([RESEÑA_1, RESEÑA_2, RESEÑA_INCOMPLETA]);
      const importador2 = new ImportadorReseñas(tf2, almacen2);
      const segunda = await importador2.importarNuevas("place-1");
      assert.equal(segunda.nuevas, 1);
      assert.equal(segunda.yaVistas, 2);
      almacen2.cerrar();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("crearTransporteImportacionReal — sin credencial", () => {
  test("sin IMPORTADOR_URL ni IMPORTADOR_API_KEY devuelve null", () => {
    const urlOriginal = process.env["IMPORTADOR_URL"];
    const claveOriginal = process.env["IMPORTADOR_API_KEY"];
    delete process.env["IMPORTADOR_URL"];
    delete process.env["IMPORTADOR_API_KEY"];
    try {
      assert.equal(crearTransporteImportacionReal(), null);
    } finally {
      if (urlOriginal !== undefined) process.env["IMPORTADOR_URL"] = urlOriginal;
      if (claveOriginal !== undefined) process.env["IMPORTADOR_API_KEY"] = claveOriginal;
    }
  });
});

describe("TransporteImportacionReal — parseo de la respuesta del proveedor", () => {
  test("interpreta reviews del proveedor y descarta filas sin los campos mínimos", async () => {
    const urlOriginal = process.env["IMPORTADOR_URL"];
    const claveOriginal = process.env["IMPORTADOR_API_KEY"];
    process.env["IMPORTADOR_URL"] = "https://api.ejemplo.com/reviews";
    process.env["IMPORTADOR_API_KEY"] = "clave-de-prueba";
    try {
      const transporte = crearTransporteImportacionReal();
      assert.notEqual(transporte, null);

      const fetchOriginal = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            reviews: [
              {
                review_id: "abc",
                author_name: "Ana",
                review_text: "Muy bueno",
                review_rating: 5,
                review_datetime_utc: "2026-09-01 10:00:00",
              },
              { review_id: "sin-autor", author_name: "", review_text: "x" },
            ],
          }),
          { status: 200 },
        )) as typeof fetch;

      try {
        const reseñas = await transporte!.obtenerReseñas("place-1");
        assert.equal(reseñas.length, 1);
        assert.equal(reseñas[0]!.autor, "Ana");
        assert.equal(reseñas[0]!.estrellas, 5);
        assert.equal(reseñas[0]!.fecha, "2026-09-01");
      } finally {
        globalThis.fetch = fetchOriginal;
      }
    } finally {
      if (urlOriginal !== undefined) process.env["IMPORTADOR_URL"] = urlOriginal;
      else delete process.env["IMPORTADOR_URL"];
      if (claveOriginal !== undefined) process.env["IMPORTADOR_API_KEY"] = claveOriginal;
      else delete process.env["IMPORTADOR_API_KEY"];
    }
  });

  test("un estado HTTP no-2xx se convierte en Error con el cuerpo, sin filtrar la clave del entorno", async () => {
    const transporte = crearTransporteImportacionReal();
    void transporte;
    process.env["IMPORTADOR_URL"] = "https://api.ejemplo.com/reviews";
    process.env["IMPORTADOR_API_KEY"] = "clave-secreta";
    const real = crearTransporteImportacionReal();
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("cuota agotada", { status: 429 })) as typeof fetch;
    try {
      await assert.rejects(
        () => real!.obtenerReseñas("place-1"),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes("429"));
          assert.ok(!error.message.includes("clave-secreta"));
          return true;
        },
      );
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });
});

// Importado desde el punto de entrada público: si esto no compila, las
// piezas no están exportadas desde indice.ts.
import {
  ImportadorReseñas as ImportadorDesdeIndice,
  AlmacenImportacionEnMemoria as AlmacenDesdeIndice,
} from "../src/indice.js";

describe("Importador — exportado desde indice.ts", () => {
  test("ImportadorReseñas y AlmacenImportacionEnMemoria se exportan", () => {
    assert.equal(typeof ImportadorDesdeIndice, "function");
    assert.equal(typeof AlmacenDesdeIndice, "function");
  });
});
