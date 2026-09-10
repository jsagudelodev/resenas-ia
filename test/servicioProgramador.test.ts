// RS.26 — integración: `crearServidor` arma y arranca el `ProgramadorImportacion`
// cuando se pasa `opciones.programadorImportacion`, y `cerrar()` lo detiene.
//
// El temporizador sigue siendo el real (`TemporizadorReal`) porque acá lo que
// se comprueba es el cableado (arranca, queda expuesto, `cerrar` lo apaga),
// no la lógica del ciclo — eso ya lo cubre `programadorImportacion.test.ts`
// con un temporizador falso. Se dispara un ciclo manualmente con
// `servidor.programador.ejecutarCicloUnaVez()` para no depender de esperar
// un intervalo real.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  crearServidor,
  AlmacenDeLotesEnMemoria,
  type ServidorLevantado,
} from "../src/servicio.js";
import {
  ImportadorReseñas,
  AlmacenImportacionEnMemoria,
  type ReseñaImportada,
  type TransporteImportacion,
} from "../src/importadorReseñas.js";
import { CatalogoNegociosSqlite } from "../src/catalogoNegocios.js";
import type { Notificador, AvisoPaquete } from "../src/notificador.js";

const FICHA = {
  nombre: "La Esquina",
  actividad: "restaurante",
  tono: "cercano" as const,
  contacto: {},
  ofrece: { gestos: [] },
  noOfrece: { gestos: [] },
  idiomaPorDefecto: "es" as const,
};

const RESEÑA: ReseñaImportada = {
  idExterno: "r1",
  autor: "Ana",
  texto: "Muy bueno",
  estrellas: 5,
  fecha: "2026-09-01",
};

function transporteFalso(reseñas: ReseñaImportada[]): TransporteImportacion {
  return { obtenerReseñas: () => Promise.resolve(reseñas) };
}

describe("crearServidor con programadorImportacion", () => {
  let servidor: ServidorLevantado;

  before(async () => {
    const importador = new ImportadorReseñas(
      transporteFalso([RESEÑA]),
      new AlmacenImportacionEnMemoria(),
    );
    servidor = await crearServidor(
      {
        importador,
        programadorImportacion: {
          intervaloMs: 3_600_000, // una hora: no debe dispararse solo durante el test
          negocios: [{ placeId: "place-1", ficha: FICHA }],
        },
      },
      new AlmacenDeLotesEnMemoria(),
    );
  });

  after(async () => {
    await servidor.cerrar();
  });

  test("el programador queda expuesto, corriendo, con el negocio registrado", () => {
    assert.notEqual(servidor.programador, undefined);
    assert.equal(servidor.programador!.corriendo, true);
    assert.equal(servidor.programador!.listarNegocios().length, 1);
  });

  test("ejecutar un ciclo manual procesa el negocio y guarda un paquete descargable", async () => {
    const resultados = await servidor.programador!.ejecutarCicloUnaVez();
    assert.equal(resultados.length, 1);
    assert.equal(resultados[0]!.ok, true);
    assert.equal(resultados[0]!.nuevas, 1);

    // El paquete se guardó en el mismo almacén que usa POST /lotes/importar:
    // se puede descargar por la ruta existente sin conocer el id de antemano
    // en producción (aquí sí lo conocemos porque es el único paquete creado),
    // así que basta con comprobar que el almacén no está vacío consultando
    // la ruta de importación manual sobre el mismo negocio: como ya se
    // importó, debe salir "yaVistas".
    const respuesta = await fetch(`${servidor.url}/lotes/importar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId: "place-1", ficha: FICHA }),
    });
    const cuerpo = (await respuesta.json()) as { yaVistas: number; nuevas: number };
    assert.equal(cuerpo.nuevas, 0);
    assert.equal(cuerpo.yaVistas, 1);
  });

  test("registrar un negocio nuevo en caliente lo suma al seguimiento", async () => {
    await servidor.programador!.registrarNegocio({ placeId: "place-2", ficha: FICHA });
    assert.equal(servidor.programador!.listarNegocios().length, 2);
  });
});

describe("crearServidor sin importador ignora programadorImportacion", () => {
  test("no arranca ningún programador si falta el importador", async () => {
    const servidor = await crearServidor(
      { programadorImportacion: { intervaloMs: 60_000 } },
      new AlmacenDeLotesEnMemoria(),
    );
    try {
      assert.equal(servidor.programador, undefined);
    } finally {
      await servidor.cerrar();
    }
  });
});

describe("crearServidor cierra el programador al cerrar el servidor", () => {
  test("tras cerrar(), el programador deja de estar corriendo", async () => {
    const importador = new ImportadorReseñas(
      transporteFalso([]),
      new AlmacenImportacionEnMemoria(),
    );
    const servidor = await crearServidor(
      { importador, programadorImportacion: { intervaloMs: 3_600_000 } },
      new AlmacenDeLotesEnMemoria(),
    );
    const programador = servidor.programador!;
    assert.equal(programador.corriendo, true);
    await servidor.cerrar();
    assert.equal(programador.corriendo, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RS.27 — el catálogo persistente sobrevive a "reiniciar el proceso": un
// servidor nuevo, apuntando al mismo archivo, recupera el negocio SIN que
// nadie repita `negocios` en las opciones de arranque.
// ─────────────────────────────────────────────────────────────────────────────

describe("crearServidor con catálogo persistente — sobrevive a reiniciar", () => {
  test("un servidor nuevo sobre el mismo catálogo recupera el negocio registrado antes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "servicio-catalogo-"));
    const ruta = join(dir, "catalogo.db");
    try {
      // "Arranque 1": registra un negocio en caliente (queda persistido).
      const catalogo1 = new CatalogoNegociosSqlite(ruta);
      const importador1 = new ImportadorReseñas(transporteFalso([]), new AlmacenImportacionEnMemoria());
      const servidor1 = await crearServidor(
        { importador: importador1, programadorImportacion: { intervaloMs: 3_600_000, catalogo: catalogo1 } },
        new AlmacenDeLotesEnMemoria(),
      );
      await servidor1.programador!.registrarNegocio({ placeId: "place-1", ficha: FICHA });
      await servidor1.cerrar();
      catalogo1.cerrar();

      // "Arranque 2": servidor nuevo, mismo archivo de catálogo, SIN pasar
      // `negocios` — el negocio debe estar ahí de todas formas.
      const catalogo2 = new CatalogoNegociosSqlite(ruta);
      const importador2 = new ImportadorReseñas(transporteFalso([]), new AlmacenImportacionEnMemoria());
      const servidor2 = await crearServidor(
        { importador: importador2, programadorImportacion: { intervaloMs: 3_600_000, catalogo: catalogo2 } },
        new AlmacenDeLotesEnMemoria(),
      );
      try {
        const negocios = servidor2.programador!.listarNegocios();
        assert.equal(negocios.length, 1);
        assert.equal(negocios[0]!.placeId, "place-1");
      } finally {
        await servidor2.cerrar();
        catalogo2.cerrar();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RS.28 — el aviso automático. Usa un intervalo real corto y una espera real
// corta a propósito: lo que se comprueba aquí es que `crearServidor` compone
// bien el aviso (enlace real generado por `almacen`, ficha del negocio,
// conteos del paquete) cuando el temporizador de verdad dispara un ciclo —
// la lógica del ciclo en sí ya está cubierta sin timers reales en
// `programadorImportacion.test.ts`.
// ─────────────────────────────────────────────────────────────────────────────

function notificadorFalso(): Notificador & { avisos: AvisoPaquete[] } {
  const avisos: AvisoPaquete[] = [];
  return {
    avisos,
    avisar: async (aviso: AvisoPaquete) => {
      avisos.push(aviso);
    },
  };
}

describe("crearServidor con notificador — cierre RS.28", () => {
  test("tras un ciclo automático, se avisa con el enlace, la ficha y los conteos del paquete", async () => {
    const importador = new ImportadorReseñas(
      transporteFalso([RESEÑA]),
      new AlmacenImportacionEnMemoria(),
    );
    const notificador = notificadorFalso();
    const servidor = await crearServidor(
      {
        importador,
        programadorImportacion: {
          intervaloMs: 30,
          negocios: [{ placeId: "place-1", ficha: FICHA }],
          notificador,
        },
      },
      new AlmacenDeLotesEnMemoria(),
    );
    try {
      await new Promise((r) => setTimeout(r, 250));
      assert.equal(notificador.avisos.length, 1);
      const aviso = notificador.avisos[0]!;
      assert.equal(aviso.placeId, "place-1");
      assert.equal(aviso.nombreNegocio, "La Esquina");
      assert.equal(aviso.conteos.listas, 1);
      assert.ok(aviso.enlaceUrl.startsWith(servidor.url));
      assert.ok(aviso.enlaceUrl.includes("/enlace/"));

      // El enlace avisado es real: canjearlo debe descargar el paquete.
      const descarga = await fetch(aviso.enlaceUrl);
      assert.equal(descarga.status, 200);
      const csv = await descarga.text();
      assert.ok(csv.includes("Ana"));
    } finally {
      await servidor.cerrar();
    }
  });

  test("un notificador que falla no tumba el servidor: sigue respondiendo", async () => {
    const importador = new ImportadorReseñas(
      transporteFalso([RESEÑA]),
      new AlmacenImportacionEnMemoria(),
    );
    const notificadorCaido: Notificador = {
      avisar: () => Promise.reject(new Error("webhook no responde")),
    };
    const servidor = await crearServidor(
      {
        importador,
        programadorImportacion: {
          intervaloMs: 30,
          negocios: [{ placeId: "place-1", ficha: FICHA }],
          notificador: notificadorCaido,
        },
      },
      new AlmacenDeLotesEnMemoria(),
    );
    try {
      await new Promise((r) => setTimeout(r, 250));
      const salud = await fetch(`${servidor.url}/salud`);
      assert.equal(salud.status, 200);
    } finally {
      await servidor.cerrar();
    }
  });

  test("sin notificador configurado, un ciclo automático no falla por falta de aviso", async () => {
    const importador = new ImportadorReseñas(
      transporteFalso([RESEÑA]),
      new AlmacenImportacionEnMemoria(),
    );
    const servidor = await crearServidor(
      {
        importador,
        programadorImportacion: {
          intervaloMs: 30,
          negocios: [{ placeId: "place-1", ficha: FICHA }],
        },
      },
      new AlmacenDeLotesEnMemoria(),
    );
    try {
      await new Promise((r) => setTimeout(r, 250));
      const salud = await fetch(`${servidor.url}/salud`);
      assert.equal(salud.status, 200);
    } finally {
      await servidor.cerrar();
    }
  });
});
