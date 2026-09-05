// RS.9 — El resumen de qué se queja la gente.
//
// Cierre: (1) sobre un lote de prueba, el resumen dice los motivos que se
// repiten y cuántas reseñas hay en cada uno; (2) cada cifra se puede
// rastrear: por cada motivo se puede pedir la lista de reseñas que lo
// componen; (3) el resumen no inventa: con dos reseñas no dice que haya
// un patrón, dice que no hay suficientes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resumirQuejas, UMBRAL_MINIMO_DEFECTO } from "../src/resumirQuejas.js";
import type { ResultadoProcesamientoLote } from "../src/procesarLote.js";
import type {
  ResultadoRedaccion,
  RespuestaLista,
  RespuestaNoDisponible,
  RespuestaParaRevision,
} from "../src/generarRespuesta.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers para construir lotes a medida de cada test, sin red ni credenciales.
// ─────────────────────────────────────────────────────────────────────────────

function lista(texto: string, idioma: "es" | "en" = "es"): RespuestaLista {
  return { texto, idioma, intentoDeInyeccion: [] };
}

function noDisponible(motivo: string, idioma: "es" | "en" = "es"): RespuestaNoDisponible {
  return { noDisponible: true, motivo, idioma, intentoDeInyeccion: [] };
}

function paraRevision(
  motivo: string,
  idioma: "es" | "en" = "es",
): RespuestaParaRevision {
  return {
    revisionHumana: true,
    borrador: "borrador para revisar",
    motivo,
    idioma,
    acusaciones: [],
    intentoDeInyeccion: [],
  };
}

function lote(
  resultados: ReadonlyArray<ResultadoRedaccion>,
): ResultadoProcesamientoLote {
  return { resultados, listas: 0, paraRevision: 0, fallaron: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.9 — punto 1: el resumen dice los motivos que se repiten y
// cuántas reseñas hay en cada uno.
// ─────────────────────────────────────────────────────────────────────────────

test("resumirQuejas: cuenta cuántas reseñas comparten cada motivo", () => {
  // 4 reseñas con acusación de intoxicación, 2 con cobro indebido, 1 con
  // trato discriminatorio. El resumen debe agrupar por motivo y contar.
  const resultados: ResultadoRedaccion[] = [
    paraRevision("la reseña alega una posible intoxicación; hay que verificarla antes de responder."),
    lista("Gracias por todo."),
    paraRevision("la reseña alega una posible intoxicación; hay que verificarla antes de responder."),
    paraRevision("la reseña alega un cobro indebido; hay que revisar el ticket antes de responder."),
    paraRevision("la reseña alega una posible intoxicación; hay que verificarla antes de responder."),
    noDisponible("el redactor cayó: sin red"),
    paraRevision("la reseña alega un cobro indebido; hay que revisar el ticket antes de responder."),
    paraRevision("la reseña alega un trato discriminatorio; hay que revisarla antes de responder."),
    paraRevision("la reseña alega una posible intoxicación; hay que verificarla antes de responder."),
  ];
  const resumen = resumirQuejas(lote(resultados));

  assert.equal(resumen.totalReseñas, 9);
  assert.equal(resumen.umbralMinimo, UMBRAL_MINIMO_DEFECTO);

  // Tres motivos por encima del umbral: intoxicación (4), cobro (2).
  // El trato discriminatorio (1) NO entra: está por debajo del umbral.
  // El motivo del noDisponible (1) tampoco.
  assert.equal(resumen.cantidadMotivos, 2, "solo los motivos con ≥ 2 reseñas");

  const intoxicacion = resumen.motivos.find((m) =>
    m.motivo.includes("intoxicación"),
  );
  assert.ok(intoxicacion, "debe aparecer el motivo de intoxicación");
  assert.equal(intoxicacion.cantidad, 4);

  const cobro = resumen.motivos.find((m) =>
    m.motivo.includes("cobro indebido"),
  );
  assert.ok(cobro, "debe aparecer el motivo de cobro indebido");
  assert.equal(cobro.cantidad, 2);

  const discriminacion = resumen.motivos.find((m) =>
    m.motivo.includes("trato discriminatorio"),
  );
  assert.equal(discriminacion, undefined, "1 reseña no es patrón");
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.9 — punto 2: cada cifra se puede rastrear — por cada motivo
// se puede pedir la lista de reseñas que lo componen.
// ─────────────────────────────────────────────────────────────────────────────

test("resumirQuejas: por cada motivo se puede pedir la lista de reseñas que lo componen", () => {
  // 3 reseñas con el mismo motivo: deben aparecer con los índices exactos
  // 0, 2, 5. Eso permite pedirle al lote las reseñas y verificar.
  const motivoIntox =
    "la reseña alega una posible intoxicación; hay que verificarla antes de responder.";
  const resultados: ResultadoRedaccion[] = [
    paraRevision(motivoIntox),
    lista("gracias"),
    paraRevision(motivoIntox),
    lista("todo bien"),
    lista("me encantó"),
    paraRevision(motivoIntox),
  ];
  const resumen = resumirQuejas(lote(resultados));

  assert.equal(resumen.motivos.length, 1);
  const m = resumen.motivos[0];
  assert.ok(m);
  assert.equal(m.cantidad, 3);
  assert.deepEqual([...m.indices], [0, 2, 5]);

  // Y al pedirle al lote original las reseñas en esos índices, son las
  // que llevan ese motivo.
  for (const i of m.indices) {
    const r = resultados[i];
    assert.ok(r);
    assert.ok("revisionHumana" in r, `índice ${i} debe ser revisión humana`);
    if ("revisionHumana" in r) {
      assert.equal(r.motivo, motivoIntox);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.9 — punto 3: el resumen no inventa — con dos reseñas no dice
// que haya un patrón, dice que no hay suficientes.
// ─────────────────────────────────────────────────────────────────────────────

test("resumirQuejas: con un motivo que solo aparece una vez, dice que no hay suficientes", () => {
  // Cada motivo aparece exactamente una vez. El resumen debe estar vacío
  // y reportar `sinSuficientes: true`.
  const resultados: ResultadoRedaccion[] = [
    paraRevision("la reseña alega una posible intoxicación; hay que verificarla antes de responder."),
    lista("gracias por la atención"),
    noDisponible("el redactor cayó: sin red"),
    paraRevision("la reseña alega un cobro indebido; hay que revisar el ticket antes de responder."),
  ];
  const resumen = resumirQuejas(lote(resultados));

  assert.equal(resumen.cantidadMotivos, 0);
  assert.deepEqual([...resumen.motivos], []);
  assert.equal(resumen.sinSuficientes, true);
});

test("resumirQuejas: con dos reseñas no dice que haya un patrón", () => {
  // El lote tiene exactamente 2 reseñas y motivos distintos. No hay patrón.
  const resultados: ResultadoRedaccion[] = [
    paraRevision("la reseña alega una posible intoxicación; hay que verificarla antes de responder."),
    lista("gracias"),
  ];
  const resumen = resumirQuejas(lote(resultados));

  assert.equal(resumen.totalReseñas, 2);
  assert.equal(resumen.cantidadMotivos, 0);
  assert.equal(resumen.sinSuficientes, true);
});

test("resumirQuejas: con dos reseñas y el mismo motivo sí lo reporta", () => {
  // El mínimo del cierre: 2 reseñas con el mismo motivo → es patrón.
  const motivoIntox =
    "la reseña alega una posible intoxicación; hay que verificarla antes de responder.";
  const resultados: ResultadoRedaccion[] = [
    paraRevision(motivoIntox),
    paraRevision(motivoIntox),
  ];
  const resumen = resumirQuejas(lote(resultados));

  assert.equal(resumen.cantidadMotivos, 1);
  assert.equal(resumen.sinSuficientes, false);
  const m0 = resumen.motivos[0];
  assert.ok(m0, "debe haber un motivo");
  assert.equal(m0.cantidad, 2);
  assert.deepEqual([...m0.indices], [0, 1]);
});

test("resumirQuejas: el umbral mínimo se puede ajustar", () => {
  // Si subimos el umbral a 3, dos reseñas con el mismo motivo ya no
  // cuentan; con 3 sí.
  const motivoIntox =
    "la reseña alega una posible intoxicación; hay que verificarla antes de responder.";
  const resultados: ResultadoRedaccion[] = [
    paraRevision(motivoIntox),
    paraRevision(motivoIntox),
    paraRevision(motivoIntox),
  ];
  const resumen2 = resumirQuejas(lote(resultados), 2);
  assert.equal(resumen2.cantidadMotivos, 1);
  assert.equal(resumen2.umbralMinimo, 2);

  const resumen3 = resumirQuejas(lote(resultados), 3);
  assert.equal(resumen3.cantidadMotivos, 1);
  assert.equal(resumen3.umbralMinimo, 3);

  const resumen4 = resumirQuejas(lote(resultados), 4);
  assert.equal(resumen4.cantidadMotivos, 0);
  assert.equal(resumen4.sinSuficientes, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pruebas complementarias (no del cierre, pero blindan el comportamiento).
// ─────────────────────────────────────────────────────────────────────────────

test("resumirQuejas: las respuestas listas no cuentan como motivo de queja", () => {
  // 5 respuestas listas, 0 motivos: el resumen está vacío.
  const resultados: ResultadoRedaccion[] = [
    lista("r1"),
    lista("r2"),
    lista("r3"),
    lista("r4"),
    lista("r5"),
  ];
  const resumen = resumirQuejas(lote(resultados));
  assert.equal(resumen.cantidadMotivos, 0);
  assert.equal(resumen.totalReseñas, 5);
  assert.equal(resumen.sinSuficientes, true);
});

test("resumirQuejas: lote vacío devuelve resumen vacío y sinSuficientes", () => {
  const resumen = resumirQuejas(lote([]));
  assert.equal(resumen.totalReseñas, 0);
  assert.equal(resumen.cantidadMotivos, 0);
  assert.equal(resumen.sinSuficientes, true);
});

test("resumirQuejas: rechaza umbrales inválidos", () => {
  const resultados: ResultadoRedaccion[] = [lista("r1")];
  assert.throws(
    () => resumirQuejas(lote(resultados), 0),
    /umbral mínimo/,
  );
  assert.throws(
    () => resumirQuejas(lote(resultados), -1),
    /umbral mínimo/,
  );
  assert.throws(
    () => resumirQuejas(lote(resultados), 1.5),
    /umbral mínimo/,
  );
});