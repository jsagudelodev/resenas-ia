// RS.12 — El paquete, listo para entregar.
//
// Cierre: (1) se exporta a Markdown y a CSV, y al releer el CSV los valores
// coinciden exactamente con los del resultado; (2) las reseñas para revisión
// humana salen separadas de las listas, no mezcladas; (3) el CSV se abre bien
// en un Excel en español (separador y codificación correctos).
//
// Todo con lotes construidos a mano: sin red, sin credenciales y sin LLM.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exportarCSV,
  exportarMarkdown,
  parsearCSV,
  filasDelLote,
  filasListasDelLote,
  separarParaRevisionYFallida,
  CABECERA_CSV,
  SEPARADOR_CSV,
  BOM_UTF8,
  type FilaPaquete,
} from "../src/empaquetar.js";
import type { ResultadoProcesamientoLote } from "../src/procesarLote.js";
import type {
  ResultadoRedaccion,
  RespuestaLista,
  RespuestaNoDisponible,
  RespuestaParaRevision,
} from "../src/generarRespuesta.js";
import type { ReseñaNegocio } from "../src/convertirReseñas.js";

function lista(texto: string): RespuestaLista {
  return { texto, idioma: "es", intentoDeInyeccion: [], cobrada: true };
}

function noDisponible(motivo: string): RespuestaNoDisponible {
  return { noDisponible: true, motivo, idioma: "es", intentoDeInyeccion: [], cobrada: false };
}

function paraRevision(borrador: string, motivo: string): RespuestaParaRevision {
  return {
    revisionHumana: true,
    borrador,
    motivo,
    idioma: "es",
    acusaciones: [],
    intentoDeInyeccion: [],
    cobrada: false,
  };
}

function lote(
  resultados: ReadonlyArray<ResultadoRedaccion>,
): ResultadoProcesamientoLote {
  let listas = 0;
  let paraRevisionCt = 0;
  let fallaron = 0;
  for (const r of resultados) {
    if ("texto" in r) listas += 1;
    else if ("revisionHumana" in r) paraRevisionCt += 1;
    else fallaron += 1;
  }
  return { resultados, listas, paraRevision: paraRevisionCt, fallaron };
}

function reseña(
  autor: string,
  texto: string,
  estrellas: number | null,
  fecha: string | null,
): ReseñaNegocio {
  return {
    autor,
    texto,
    estrellas,
    fecha,
    incompleta: estrellas === null || fecha === null,
    motivo: estrellas === null ? "sin estrellas" : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Punto 1: al releer el CSV, los valores coinciden EXACTAMENTE.
// ─────────────────────────────────────────────────────────────────────────────

/** Filas con todo lo que puede romper un CSV: ; " \n acentos ñ nulls. */
function filasEscollo(): FilaPaquete[] {
  return [
    {
      indice: 0,
      autor: "María Núñez",
      estrellas: 5,
      fecha: "2026-03-01",
      textoResena: "Todo riquísimo, volveremos; muy atento el personal.",
      estado: "lista",
      respuesta: "Gracias, María. Esperamos volver a atenderle.",
      motivo: "",
      idioma: "es",
      intentosDeInyeccion: 0,
      cobrada: true,
    },
    {
      indice: 1,
      autor: 'El "Crítico" de la ciudad',
      estrellas: 1,
      fecha: null,
      textoResena: "Primera línea\nsegunda línea con ; y \"comillas\".",
      estado: "paraRevision",
      respuesta: "Borrador con ñ, acentos y ; dentro.",
      motivo: "la reseña alega una posible intoxicación; hay que verificarla.",
      idioma: "es",
      intentosDeInyeccion: 2,
      cobrada: false,
    },
    {
      indice: 2,
      autor: "John Smith",
      estrellas: null,
      fecha: "12/05/2026",
      textoResena: "",
      estado: "fallida",
      respuesta: "",
      motivo: "",
      idioma: "en",
      intentosDeInyeccion: 0,
      cobrada: false,
    },
  ];
}

test("exportarCSV + parsearCSV: los valores releídos coinciden exactamente", () => {
  const originales = filasEscollo();
  const lectura = parsearCSV(exportarCSV(originales));

  assert.deepEqual(lectura.errores, [], "un CSV propio no debe dar errores");
  assert.deepEqual(lectura.filas, originales);
});

test("parsearCSV: una fila con ; y saltos de línea dentro del texto no se parte", () => {
  const originales = filasEscollo();
  const lectura = parsearCSV(exportarCSV(originales));

  assert.equal(lectura.filas.length, 3, "3 filas escritas, 3 leídas");
  assert.equal(
    lectura.filas[1]?.textoResena,
    "Primera línea\nsegunda línea con ; y \"comillas\".",
  );
  assert.equal(lectura.filas[1]?.autor, 'El "Crítico" de la ciudad');
});

test("parsearCSV: conserva los nulos (estrellas y fecha ausentes)", () => {
  const lectura = parsearCSV(exportarCSV(filasEscollo()));
  const tercera = lectura.filas[2];

  assert.ok(tercera);
  assert.equal(tercera.estrellas, null);
  assert.equal(tercera.fecha, "12/05/2026");
  assert.equal(lectura.filas[0]?.fecha, "2026-03-01");
  assert.equal(lectura.filas[1]?.fecha, null);
});

test("filasDelLote: una fila por reseña, en el orden del lote y con su estado", () => {
  const reseñas = [
    reseña("Ana", "Genial", 5, "2026-01-01"),
    reseña("Bea", "Me senté mal", 1, "2026-01-02"),
    reseña("Cy", "regular", 3, null),
  ];
  const l = lote([
    lista("Gracias, Ana."),
    paraRevision("Borrador de Bea.", "acusación grave; revisar."),
    noDisponible("el redactor cayó: sin red"),
  ]);
  const filas = filasDelLote(l, reseñas);

  assert.deepEqual(
    filas.map((f) => f.indice),
    [0, 1, 2],
  );
  assert.deepEqual(
    filas.map((f) => f.estado),
    ["lista", "paraRevision", "fallida"],
  );
  assert.equal(filas[0]?.respuesta, "Gracias, Ana.");
  assert.equal(filas[1]?.respuesta, "Borrador de Bea.", "el borrador viaja");
  assert.equal(filas[1]?.motivo, "acusación grave; revisar.");
  assert.equal(filas[2]?.respuesta, "", "lo fallido no tiene nada que pegar");
  assert.equal(filas[2]?.motivo, "el redactor cayó: sin red");
  assert.equal(filas[2]?.fecha, null, "la fecha ausente no se inventa");
});

// ─────────────────────────────────────────────────────────────────────────────
// Punto 2: lo que va a revisión humana sale SEPARADO de lo que está listo.
// ─────────────────────────────────────────────────────────────────────────────

const reseñasMixtas: ReseñaNegocio[] = [
  reseña("Ana", "Genial", 5, "2026-01-01"),
  reseña("Bea", "Me intoxicaron", 1, "2026-01-02"),
  reseña("Cy", "regular", 3, null),
  reseña("Dea", "Óptimo", 4, "2026-01-04"),
];

const loteMixto = lote([
  lista("Gracias, Ana."),
  paraRevision("Borrador de Bea.", "acusación de intoxicación; revisar."),
  noDisponible("el redactor cayó: sin red"),
  lista("Gracias, Dea."),
]);

test("separarParaRevisionYFallida: las tres pilas no se mezclan", () => {
  const pilas = separarParaRevisionYFallida(loteMixto, reseñasMixtas);

  assert.deepEqual(
    pilas.listas.map((f) => f.indice),
    [0, 3],
  );
  assert.deepEqual(
    pilas.paraRevision.map((f) => f.indice),
    [1],
  );
  assert.deepEqual(
    pilas.fallidas.map((f) => f.indice),
    [2],
  );
  // Ninguna reseña aparece en dos pilas y ninguna se pierde.
  const total =
    pilas.listas.length + pilas.paraRevision.length + pilas.fallidas.length;
  assert.equal(total, loteMixto.resultados.length);
});

test("filasListasDelLote: solo devuelve lo pegable, nunca un borrador", () => {
  const listas = filasListasDelLote(loteMixto, reseñasMixtas);

  assert.equal(listas.length, 2);
  for (const fila of listas) {
    assert.equal(fila.estado, "lista");
    assert.notEqual(fila.respuesta, "Borrador de Bea.");
  }
});

test("exportarMarkdown: los bloques van separados y el borrador no aparece entre los listos", () => {
  const md = exportarMarkdown(loteMixto, reseñasMixtas, "Restaurante La Esquina");

  const iListas = md.indexOf("## Respuestas listas para pegar");
  const iRevision = md.indexOf("## Borradores para revisión humana");
  const iFallidas = md.indexOf("## Reseñas sin respuesta");

  assert.ok(iListas >= 0, "debe existir el bloque de listas");
  assert.ok(iRevision > iListas, "el bloque de revisión va aparte");
  assert.ok(iFallidas > iRevision, "el bloque de fallidas va aparte");

  const bloqueListas = md.slice(iListas, iRevision);
  assert.ok(bloqueListas.includes("Gracias, Ana."));
  assert.ok(!bloqueListas.includes("Borrador de Bea."), "no mezclado");
  assert.ok(!bloqueListas.includes("el redactor cayó"));

  const bloqueRevision = md.slice(iRevision, iFallidas);
  assert.ok(bloqueRevision.includes("Borrador de Bea."));
  assert.ok(bloqueRevision.includes("acusación de intoxicación; revisar."));

  // Cabecera con los conteos del lote, para que el dueño sepa qué recibe.
  assert.ok(md.includes("# Respuestas para Restaurante La Esquina"));
  assert.ok(md.includes("Listas para pegar: 2"));
  assert.ok(md.includes("Para revisión humana: 1"));
  assert.ok(md.includes("Sin respuesta: 1"));
});

test("exportarMarkdown: un lote sin fallidas dice «Ninguna.» en ese bloque", () => {
  const unaResena: ReadonlyArray<ReseñaNegocio> = [
    reseña("Ana", "Genial", 5, "2026-01-01"),
  ];
  const soloListas = lote([lista("Gracias, Ana.")]);
  const md = exportarMarkdown(soloListas, unaResena, "La Esquina");

  assert.ok(md.includes("## Reseñas sin respuesta"));
  assert.equal((md.match(/_Ninguna\._/g) ?? []).length, 2, "revisión y fallidas vacías");
});

// ─────────────────────────────────────────────────────────────────────────────
// Punto 3: el CSV se abre bien en un Excel en español.
// ─────────────────────────────────────────────────────────────────────────────

test("exportarCSV: separador ; y BOM UTF-8, lo que espera un Excel en español", () => {
  const csv = exportarCSV(filasEscollo());

  assert.ok(csv.startsWith(BOM_UTF8), "el archivo arranca con BOM UTF-8");
  assert.equal(BOM_UTF8, "\uFEFF", "el BOM es el de Excel, no cualquier carácter");
  assert.equal(SEPARADOR_CSV, ";", "separador de lista en Excel en español");

  const primeraLinea = csv.slice(BOM_UTF8.length).split("\r\n")[0];
  assert.equal(primeraLinea, CABECERA_CSV.join(";"));
  assert.ok(
    !(primeraLinea ?? "").includes(","),
    "la cabecera no usa coma: un Excel en español partiría mal las columnas",
  );
});

test("exportarCSV: cada registro en su línea CRLF y los campos problemáticos entrecomillados", () => {
  const csv = exportarCSV(filasEscollo());
  const sinBom = csv.slice(BOM_UTF8.length);

  // 3 filas + cabecera + salto final.
  assert.ok(sinBom.endsWith("\r\n"));
  // Un texto con salto de línea va entrecomillado, así que los CRLF de
  // registro no se confunden con el \n del texto: se leen 4 registros.
  const lectura = parsearCSV(csv);
  assert.equal(lectura.filas.length, 3);
  assert.ok(
    sinBom.includes('"Todo riquísimo, volveremos; muy atento el personal."'),
    "un texto con ; y coma va entero entre comillas",
  );
  assert.ok(sinBom.includes('""Crítico""'), "las comillas dobles se duplican (RFC 4180)");
});

test("parsearCSV: una cabecera ajena devuelve un motivo comprensible, no una excepción", () => {
  const lectura = parsearCSV(BOM_UTF8 + "a;b\r\n1;2\r\n");

  assert.equal(lectura.filas.length, 0);
  assert.equal(lectura.errores.length, 1);
  assert.match(lectura.errores[0] ?? "", /cabecera/);
});

test("parsearCSV: un estado desconocido se reporta por fila y no tumba la lectura", () => {
  const csv = exportarCSV(filasEscollo());
  const manipulado = csv.replace("paraRevision", "yaVeremos");
  const lectura = parsearCSV(manipulado);

  assert.equal(lectura.filas.length, 2, "las filas buenas se leen igual");
  assert.equal(lectura.errores.length, 1);
  assert.match(lectura.errores[0] ?? "", /estado desconocido/);
});
