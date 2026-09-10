// RS.26 — Traer lo nuevo sola, sin que nadie la dispare.
//
// Cubre el módulo `ProgramadorImportacion` en aislamiento, con un
// temporizador falso (nunca un `setInterval` real: la suite corre sin
// esperar el paso del tiempo) y una fuente de reseñas falsa (no depende de
// `ImportadorReseñas` ni de su transporte).
//
// Cierre: (1) registrar/quitar/listar negocios sobre la marcha; (2) un
// negocio que falla no cancela el ciclo para los demás; (3) `iniciar` es
// idempotente y `detener` cancela de verdad — un disparo del temporizador
// después de `detener` no hace nada.

import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

import {
  ProgramadorImportacion,
  type FuenteDeReseñasNuevas,
  type ManejadorDeReseñasNuevas,
  type NegocioProgramado,
  type Temporizador,
} from "../src/programadorImportacion.js";
import type { ResultadoImportacion } from "../src/importadorReseñas.js";
import type { FichaNegocio } from "../src/fichaNegocio.js";
import type { ReseñaNegocio } from "../src/convertirReseñas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Dobles de prueba
// ─────────────────────────────────────────────────────────────────────────────

const FICHA: FichaNegocio = {
  nombre: "La Esquina",
  actividad: "restaurante",
  tono: "cercano",
  contacto: {},
  ofrece: { gestos: [] },
  noOfrece: { gestos: [] },
  idiomaPorDefecto: "es",
};

function negocio(placeId: string): NegocioProgramado {
  return { placeId, ficha: FICHA };
}

const RESEÑA: ReseñaNegocio = {
  autor: "Ana",
  texto: "Muy bueno",
  estrellas: 5,
  fecha: "2026-09-01",
  incompleta: false,
  motivo: null,
};

function resultadoConReseñas(n: number): ResultadoImportacion {
  const reseñas = Array.from({ length: n }, () => RESEÑA);
  return { reseñas, totalRecibidas: n, nuevas: n, yaVistas: 0 };
}

const SIN_NOVEDADES: ResultadoImportacion = {
  reseñas: [],
  totalRecibidas: 0,
  nuevas: 0,
  yaVistas: 0,
};

/** Temporizador falso: captura la función y la dispara solo cuando el test lo pide. */
function temporizadorFalso(): Temporizador & {
  dispararUnaVez: () => void;
  intervalosProgramados: number[];
  cancelaciones: number;
} {
  let fnCapturada: (() => void) | null = null;
  const intervalosProgramados: number[] = [];
  let cancelaciones = 0;
  return {
    cada(intervaloMs: number, fn: () => void) {
      intervalosProgramados.push(intervaloMs);
      fnCapturada = fn;
      return {
        cancelar: () => {
          cancelaciones++;
          fnCapturada = null;
        },
      };
    },
    dispararUnaVez() {
      fnCapturada?.();
    },
    intervalosProgramados,
    get cancelaciones() {
      return cancelaciones;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro de negocios sobre la marcha
// ─────────────────────────────────────────────────────────────────────────────

describe("ProgramadorImportacion — registrar/quitar/listar negocios", () => {
  test("registrar añade, listar lo refleja, quitar lo saca", async () => {
    const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(SIN_NOVEDADES) };
    const manejador: ManejadorDeReseñasNuevas = async () => undefined;
    const programador = new ProgramadorImportacion(fuente, manejador);

    await programador.registrarNegocio(negocio("place-1"));
    await programador.registrarNegocio(negocio("place-2"));
    assert.equal(programador.listarNegocios().length, 2);

    const quitado = await programador.quitarNegocio("place-1");
    assert.equal(quitado, true);
    assert.equal(programador.listarNegocios().length, 1);
    assert.equal(programador.listarNegocios()[0]!.placeId, "place-2");

    const quitadoDeNuevo = await programador.quitarNegocio("place-1");
    assert.equal(quitadoDeNuevo, false);
  });

  test("registrar dos veces el mismo placeId actualiza la ficha, no duplica", async () => {
    const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(SIN_NOVEDADES) };
    const programador = new ProgramadorImportacion(fuente, async () => undefined);
    await programador.registrarNegocio(negocio("place-1"));
    const fichaNueva: FichaNegocio = { ...FICHA, nombre: "La Esquina Norte" };
    await programador.registrarNegocio({ placeId: "place-1", ficha: fichaNueva });
    assert.equal(programador.listarNegocios().length, 1);
    assert.equal(programador.listarNegocios()[0]!.ficha.nombre, "La Esquina Norte");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ejecutarCicloUnaVez: el corazón del programador
// ─────────────────────────────────────────────────────────────────────────────

describe("ProgramadorImportacion — ejecutarCicloUnaVez", () => {
  test("un negocio con reseñas nuevas llama al manejador con esas reseñas", async () => {
    const fuente: FuenteDeReseñasNuevas = {
      importarNuevas: (placeId: string) =>
        Promise.resolve(placeId === "place-1" ? resultadoConReseñas(2) : SIN_NOVEDADES),
    };
    const manejador = mock.fn<ManejadorDeReseñasNuevas>(async () => undefined);
    const programador = new ProgramadorImportacion(fuente, manejador);
    await programador.registrarNegocio(negocio("place-1"));

    const resultados = await programador.ejecutarCicloUnaVez();

    assert.equal(manejador.mock.calls.length, 1);
    assert.equal(manejador.mock.calls[0]!.arguments[0]!.placeId, "place-1");
    assert.equal(manejador.mock.calls[0]!.arguments[1]!.length, 2);
    assert.deepEqual(resultados, [{ placeId: "place-1", ok: true, nuevas: 2 }]);
  });

  test("RS.28: si el manejador reporta un paquete producido, el resultado lo lleva", async () => {
    const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(resultadoConReseñas(3)) };
    const manejador: ManejadorDeReseñasNuevas = async () => ({
      id: "paquete-abc",
      conteos: { listas: 2, paraRevision: 1, fallaron: 0 },
    });
    const programador = new ProgramadorImportacion(fuente, manejador);
    await programador.registrarNegocio(negocio("place-1"));

    const [resultado] = await programador.ejecutarCicloUnaVez();
    assert.deepEqual(resultado!.paquete, { id: "paquete-abc", conteos: { listas: 2, paraRevision: 1, fallaron: 0 } });
  });

  test("un negocio sin reseñas nuevas NO llama al manejador", async () => {
    const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(SIN_NOVEDADES) };
    const manejador = mock.fn<ManejadorDeReseñasNuevas>(async () => undefined);
    const programador = new ProgramadorImportacion(fuente, manejador);
    await programador.registrarNegocio(negocio("place-1"));

    const resultados = await programador.ejecutarCicloUnaVez();

    assert.equal(manejador.mock.calls.length, 0);
    assert.deepEqual(resultados, [{ placeId: "place-1", ok: true, nuevas: 0 }]);
  });

  test("un negocio cuya fuente falla NO cancela el ciclo para los demás", async () => {
    const fuente: FuenteDeReseñasNuevas = {
      importarNuevas: (placeId: string) => {
        if (placeId === "place-caido") {
          return Promise.reject(new Error("proveedor no responde"));
        }
        return Promise.resolve(resultadoConReseñas(1));
      },
    };
    const manejador = mock.fn<ManejadorDeReseñasNuevas>(async () => undefined);
    const programador = new ProgramadorImportacion(fuente, manejador);
    await programador.registrarNegocio(negocio("place-caido"));
    await programador.registrarNegocio(negocio("place-ok"));

    const resultados = await programador.ejecutarCicloUnaVez();

    assert.equal(resultados.length, 2);
    const caido = resultados.find((r) => r.placeId === "place-caido")!;
    const ok = resultados.find((r) => r.placeId === "place-ok")!;
    assert.equal(caido.ok, false);
    assert.ok(caido.motivo?.includes("proveedor no responde"));
    assert.equal(ok.ok, true);
    assert.equal(ok.nuevas, 1);
    // El manejador solo se llamó para el negocio que sí trajo reseñas.
    assert.equal(manejador.mock.calls.length, 1);
    assert.equal(manejador.mock.calls[0]!.arguments[0]!.placeId, "place-ok");
  });

  test("un negocio cuyo manejador lanza también queda contenido, no tumba el ciclo", async () => {
    const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(resultadoConReseñas(1)) };
    const manejador: ManejadorDeReseñasNuevas = async (n) => {
      if (n.placeId === "place-1") throw new Error("el pipeline falló procesando el lote");
      return undefined;
    };
    const programador = new ProgramadorImportacion(fuente, manejador);
    await programador.registrarNegocio(negocio("place-1"));
    await programador.registrarNegocio(negocio("place-2"));

    const resultados = await programador.ejecutarCicloUnaVez();
    const uno = resultados.find((r) => r.placeId === "place-1")!;
    const dos = resultados.find((r) => r.placeId === "place-2")!;
    assert.equal(uno.ok, false);
    assert.ok(uno.motivo?.includes("el pipeline falló"));
    assert.equal(dos.ok, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// iniciar / detener con temporizador falso
// ─────────────────────────────────────────────────────────────────────────────

describe("ProgramadorImportacion — iniciar/detener", () => {
  test("iniciar programa el temporizador con el intervalo dado", () => {
    const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(SIN_NOVEDADES) };
    const temporizador = temporizadorFalso();
    const programador = new ProgramadorImportacion(fuente, async () => undefined, temporizador);

    assert.equal(programador.corriendo, false);
    programador.iniciar(60_000);
    assert.equal(programador.corriendo, true);
    assert.deepEqual(temporizador.intervalosProgramados, [60_000]);
  });

  test("iniciar dos veces no duplica el temporizador (idempotente)", () => {
    const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(SIN_NOVEDADES) };
    const temporizador = temporizadorFalso();
    const programador = new ProgramadorImportacion(fuente, async () => undefined, temporizador);
    programador.iniciar(60_000);
    programador.iniciar(30_000);
    assert.deepEqual(temporizador.intervalosProgramados, [60_000]);
  });

  test("disparar el temporizador ejecuta un ciclo real", async () => {
    const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(resultadoConReseñas(1)) };
    const manejador = mock.fn<ManejadorDeReseñasNuevas>(async () => undefined);
    const temporizador = temporizadorFalso();
    const programador = new ProgramadorImportacion(fuente, manejador, temporizador);
    await programador.registrarNegocio(negocio("place-1"));

    programador.iniciar(1_000);
    temporizador.dispararUnaVez();
    // El ciclo es async: esperar a que el manejador haya sido invocado.
    await new Promise((r) => setImmediate(r));

    assert.equal(manejador.mock.calls.length, 1);
  });

  test("detener cancela el temporizador y un disparo posterior no hace nada", async () => {
    const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(resultadoConReseñas(1)) };
    const manejador = mock.fn<ManejadorDeReseñasNuevas>(async () => undefined);
    const temporizador = temporizadorFalso();
    const programador = new ProgramadorImportacion(fuente, manejador, temporizador);
    await programador.registrarNegocio(negocio("place-1"));

    programador.iniciar(1_000);
    programador.detener();
    assert.equal(programador.corriendo, false);
    assert.equal(temporizador.cancelaciones, 1);

    temporizador.dispararUnaVez();
    await new Promise((r) => setImmediate(r));
    assert.equal(manejador.mock.calls.length, 0);
  });

  test("detener sin haber iniciado no lanza", () => {
    const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(SIN_NOVEDADES) };
    const programador = new ProgramadorImportacion(fuente, async () => undefined);
    assert.doesNotThrow(() => programador.detener());
  });

  test("alTerminarCiclo se llama con los resultados tras un ciclo automático", async () => {
    const fuente: FuenteDeReseñasNuevas = { importarNuevas: () => Promise.resolve(resultadoConReseñas(1)) };
    const temporizador = temporizadorFalso();
    const alTerminarCiclo = mock.fn<(r: unknown) => void>();
    const programador = new ProgramadorImportacion(
      fuente,
      async () => undefined,
      temporizador,
      alTerminarCiclo,
    );
    await programador.registrarNegocio(negocio("place-1"));

    programador.iniciar(1_000);
    temporizador.dispararUnaVez();
    await new Promise((r) => setImmediate(r));

    assert.equal(alTerminarCiclo.mock.calls.length, 1);
    const resultados = alTerminarCiclo.mock.calls[0]!.arguments[0] as Array<{ placeId: string }>;
    assert.equal(resultados[0]!.placeId, "place-1");
  });
});

// Importado desde el punto de entrada público: si esto no compila, las
// piezas no están exportadas desde indice.ts.
import { ProgramadorImportacion as ProgramadorDesdeIndice } from "../src/indice.js";

describe("Programador — exportado desde indice.ts", () => {
  test("ProgramadorImportacion se exporta", () => {
    assert.equal(typeof ProgramadorDesdeIndice, "function");
  });
});
