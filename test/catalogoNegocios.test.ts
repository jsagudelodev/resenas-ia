// RS.27 — El catálogo de negocios sobrevive a reiniciar el proceso.
//
// Cierre: (1) `registrar`/`quitar`/`listar` — alta, baja y consulta;
// (2) registrar dos veces el mismo `placeId` actualiza la ficha, no duplica
// (upsert); (3) lo guardado sobrevive a cerrar y reabrir el catálogo
// (simula reiniciar el proceso), y `ProgramadorImportacion.cargarDesdeCatalogo`
// recupera ese estado sin que nadie repita `negocios` en las opciones.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CatalogoNegociosEnMemoria,
  CatalogoNegociosSqlite,
} from "../src/catalogoNegocios.js";
import { ProgramadorImportacion, type FuenteDeReseñasNuevas } from "../src/programadorImportacion.js";
import type { FichaNegocio } from "../src/fichaNegocio.js";
import type { ResultadoImportacion } from "../src/importadorReseñas.js";

const FICHA: FichaNegocio = {
  nombre: "La Esquina",
  actividad: "restaurante",
  tono: "cercano",
  contacto: { telefono: "555-0100" },
  ofrece: { gestos: ["repetir el plato"] },
  noOfrece: { gestos: [] },
  idiomaPorDefecto: "es",
};

const SIN_NOVEDADES: ResultadoImportacion = {
  reseñas: [],
  totalRecibidas: 0,
  nuevas: 0,
  yaVistas: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// CatalogoNegociosEnMemoria — cierre punto (1) y (2)
// ─────────────────────────────────────────────────────────────────────────────

describe("CatalogoNegociosEnMemoria", () => {
  test("registrar añade, listar lo refleja, quitar lo saca", async () => {
    const catalogo = new CatalogoNegociosEnMemoria();
    await catalogo.registrar({ placeId: "place-1", ficha: FICHA });
    assert.equal((await catalogo.listar()).length, 1);

    const quitado = await catalogo.quitar("place-1");
    assert.equal(quitado, true);
    assert.deepEqual(await catalogo.listar(), []);

    const quitadoDeNuevo = await catalogo.quitar("place-1");
    assert.equal(quitadoDeNuevo, false);
  });

  test("registrar dos veces el mismo placeId actualiza la ficha, no duplica", async () => {
    const catalogo = new CatalogoNegociosEnMemoria();
    await catalogo.registrar({ placeId: "place-1", ficha: FICHA });
    const fichaNueva: FichaNegocio = { ...FICHA, nombre: "La Esquina Norte" };
    await catalogo.registrar({ placeId: "place-1", ficha: fichaNueva });
    const lista = await catalogo.listar();
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.ficha.nombre, "La Esquina Norte");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CatalogoNegociosSqlite — cierre punto (3): sobrevive a reiniciar
// ─────────────────────────────────────────────────────────────────────────────

describe("CatalogoNegociosSqlite", () => {
  test("cerrar y reabrir el catálogo conserva lo registrado", async () => {
    const dir = mkdtempSync(join(tmpdir(), "catalogo-negocios-"));
    const ruta = join(dir, "catalogo.db");
    try {
      const catalogo1 = new CatalogoNegociosSqlite(ruta);
      await catalogo1.registrar({ placeId: "place-1", ficha: FICHA });
      await catalogo1.registrar({ placeId: "place-2", ficha: { ...FICHA, nombre: "La Esquina Norte" } });
      catalogo1.cerrar();

      const catalogo2 = new CatalogoNegociosSqlite(ruta);
      const lista = await catalogo2.listar();
      assert.equal(lista.length, 2);
      const uno = lista.find((n) => n.placeId === "place-1")!;
      assert.equal(uno.ficha.nombre, "La Esquina");
      assert.equal(uno.ficha.tono, "cercano");
      assert.deepEqual(uno.ficha.ofrece.gestos, ["repetir el plato"]);
      catalogo2.cerrar();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("quitar persiste: tras reabrir, el negocio quitado sigue ausente", async () => {
    const dir = mkdtempSync(join(tmpdir(), "catalogo-negocios-"));
    const ruta = join(dir, "catalogo.db");
    try {
      const catalogo1 = new CatalogoNegociosSqlite(ruta);
      await catalogo1.registrar({ placeId: "place-1", ficha: FICHA });
      await catalogo1.registrar({ placeId: "place-2", ficha: FICHA });
      await catalogo1.quitar("place-1");
      catalogo1.cerrar();

      const catalogo2 = new CatalogoNegociosSqlite(ruta);
      const lista = await catalogo2.listar();
      assert.equal(lista.length, 1);
      assert.equal(lista[0]!.placeId, "place-2");
      catalogo2.cerrar();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("registrar dos veces el mismo placeId (upsert) sobrevive a reabrir con la ficha nueva", async () => {
    const dir = mkdtempSync(join(tmpdir(), "catalogo-negocios-"));
    const ruta = join(dir, "catalogo.db");
    try {
      const catalogo1 = new CatalogoNegociosSqlite(ruta);
      await catalogo1.registrar({ placeId: "place-1", ficha: FICHA });
      await catalogo1.registrar({ placeId: "place-1", ficha: { ...FICHA, nombre: "Renombrado" } });
      catalogo1.cerrar();

      const catalogo2 = new CatalogoNegociosSqlite(ruta);
      const lista = await catalogo2.listar();
      assert.equal(lista.length, 1);
      assert.equal(lista[0]!.ficha.nombre, "Renombrado");
      catalogo2.cerrar();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ProgramadorImportacion + catálogo: el escenario real de RS.27
// ─────────────────────────────────────────────────────────────────────────────

describe("ProgramadorImportacion con catálogo — simula reiniciar el proceso", () => {
  test("un negocio registrado en una instancia aparece en una nueva instancia sobre el mismo catálogo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "catalogo-negocios-"));
    const ruta = join(dir, "catalogo.db");
    try {
      const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(SIN_NOVEDADES) };

      // "Proceso 1": arranca, registra un negocio (que persiste al catálogo).
      const catalogo1 = new CatalogoNegociosSqlite(ruta);
      const programador1 = new ProgramadorImportacion(fuente, async () => undefined, undefined, undefined, catalogo1);
      await programador1.registrarNegocio({ placeId: "place-1", ficha: FICHA });
      assert.equal(programador1.listarNegocios().length, 1);
      catalogo1.cerrar();

      // "Proceso 2": una instancia NUEVA, sin que nadie le pase `negocios`
      // por opciones — recupera el negocio solo con cargarDesdeCatalogo.
      const catalogo2 = new CatalogoNegociosSqlite(ruta);
      const programador2 = new ProgramadorImportacion(fuente, async () => undefined, undefined, undefined, catalogo2);
      assert.equal(programador2.listarNegocios().length, 0); // antes de cargar, vacío
      await programador2.cargarDesdeCatalogo();
      assert.equal(programador2.listarNegocios().length, 1);
      assert.equal(programador2.listarNegocios()[0]!.placeId, "place-1");
      catalogo2.cerrar();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("quitarNegocio con catálogo también lo saca del catálogo (no reaparece tras cargar de nuevo)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "catalogo-negocios-"));
    const ruta = join(dir, "catalogo.db");
    try {
      const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(SIN_NOVEDADES) };
      const catalogo = new CatalogoNegociosSqlite(ruta);
      const programador = new ProgramadorImportacion(fuente, async () => undefined, undefined, undefined, catalogo);
      await programador.registrarNegocio({ placeId: "place-1", ficha: FICHA });
      await programador.quitarNegocio("place-1");
      catalogo.cerrar();

      const catalogo2 = new CatalogoNegociosSqlite(ruta);
      const programador2 = new ProgramadorImportacion(fuente, async () => undefined, undefined, undefined, catalogo2);
      await programador2.cargarDesdeCatalogo();
      assert.equal(programador2.listarNegocios().length, 0);
      catalogo2.cerrar();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sin catálogo, cargarDesdeCatalogo no hace nada (compatibilidad con RS.26)", async () => {
    const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(SIN_NOVEDADES) };
    const programador = new ProgramadorImportacion(fuente, async () => undefined);
    await assert.doesNotReject(() => programador.cargarDesdeCatalogo());
    assert.equal(programador.listarNegocios().length, 0);
  });
});

// Importado desde el punto de entrada público: si esto no compila, las
// piezas no están exportadas desde indice.ts.
import { CatalogoNegociosEnMemoria as CatalogoDesdeIndice } from "../src/indice.js";

describe("Catálogo — exportado desde indice.ts", () => {
  test("CatalogoNegociosEnMemoria se exporta", () => {
    assert.equal(typeof CatalogoDesdeIndice, "function");
  });
});
