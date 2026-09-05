// RS.7 — Responder en el idioma de la reseña.
//
// Cierre:
//   (1) una reseña en inglés recibe respuesta en inglés y una en español en
//       español;
//   (2) el idioma se detecta, no se configura por lote;
//   (3) una reseña de tres palabras («Muy bueno») no rompe la detección: si
//       no se puede decidir, se usa el idioma por defecto de la ficha y se
//       dice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectarIdioma } from "../src/detectorIdioma.js";
import { generarRespuesta, construirPrompt } from "../src/generarRespuesta.js";
import { RedactorFalso } from "../src/redactor.js";
import type { ReseñaNegocio } from "../src/convertirReseñas.js";
import type { FichaNegocio } from "../src/fichaNegocio.js";

// ─────────────────────────────────────────────────────────────────────────────
// Datos comunes
// ─────────────────────────────────────────────────────────────────────────────

const ficha: FichaNegocio = {
  nombre: "La Esquina",
  actividad: "restaurante",
  tono: "cercano",
  contacto: { telefono: "555-0100" },
  ofrece: { gestos: ["repetir el plato"] },
  noOfrece: { gestos: ["devoluciones en efectivo"] },
  idiomaPorDefecto: "es",
};

function reseña(texto: string, estrellas: number = 5): ReseñaNegocio {
  return {
    autor: "Anónimo",
    texto,
    estrellas,
    fecha: "2024-03-02",
    incompleta: false,
    motivo: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Punto 1: una reseña en inglés recibe respuesta en inglés
// ─────────────────────────────────────────────────────────────────────────────

test("reseña en inglés produce una respuesta en inglés", async () => {
  const r = reseña(
    "The service was amazing and the food was great. We will come back soon.",
  );
  const res = await generarRespuesta(r, ficha, new RedactorFalso());
  assert.ok("texto" in res, "se esperaba una respuesta lista para pegar");
  if (!("texto" in res)) return;
  assert.equal(res.idioma, "en");
  // Comprobación del texto: una respuesta en inglés empieza por "Thank you".
  assert.match(res.texto, /Thank you/);
  // Y NO contiene señales de que se haya respondido en español.
  assert.doesNotMatch(res.texto, /Gracias/);
  assert.doesNotMatch(res.texto, /atenderle/);
});

test("reseña en español produce una respuesta en español", async () => {
  const r = reseña(
    "La comida estuvo deliciosa y el servicio fue muy bueno. Volveremos pronto.",
  );
  const res = await generarRespuesta(r, ficha, new RedactorFalso());
  assert.ok("texto" in res, "se esperaba una respuesta lista para pegar");
  if (!("texto" in res)) return;
  assert.equal(res.idioma, "es");
  assert.match(res.texto, /Gracias/);
  assert.doesNotMatch(res.texto, /Thank you/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Punto 2: el idioma se detecta, no se configura por lote
// ─────────────────────────────────────────────────────────────────────────────

test("la detección se hace reseña a reseña, no por lote", async () => {
  // Misma ficha, dos reseñas en idiomas distintos: cada una recibe su idioma.
  const resEn = await generarRespuesta(
    reseña("Excellent service, we had a great time here."),
    ficha,
    new RedactorFalso(),
  );
  const resEs = await generarRespuesta(
    reseña("Servicio excelente, lo pasamos muy bien."),
    ficha,
    new RedactorFalso(),
  );
  assert.equal("noDisponible" in resEn, false);
  if ("noDisponible" in resEn) return;
  assert.equal("noDisponible" in resEs, false);
  if ("noDisponible" in resEs) return;
  assert.equal(resEn.idioma, "en");
  assert.equal(resEs.idioma, "es");
});

test("detectarIdioma mira el texto y no usa la ficha por defecto", () => {
  // Ficha con idiomaPorDefecto "es": la reseña en inglés sale en inglés.
  const r1 = detectarIdioma(
    "The service was terrible and the food was cold, we will not come back.",
    "es",
  );
  assert.equal(r1.idioma, "en");
  assert.equal(r1.confianza, "alta");
});

// ─────────────────────────────────────────────────────────────────────────────
// Punto 3: reseña corta no rompe la detección — usa idioma por defecto y lo dice
// ─────────────────────────────────────────────────────────────────────────────

test("reseña de tres palabras en español cae al idioma por defecto con motivo", () => {
  const r = detectarIdioma("Muy bueno", "es");
  assert.equal(r.idioma, "es");
  assert.equal(r.confianza, "baja");
  assert.ok(r.motivo !== null);
  assert.match(r.motivo ?? "", /idioma por defecto/i);
});

test("reseña de tres palabras en inglés cae al idioma por defecto con motivo", () => {
  const r = detectarIdioma("Really great", "en");
  assert.equal(r.idioma, "en");
  assert.equal(r.confianza, "baja");
  assert.ok(r.motivo !== null);
  assert.match(r.motivo ?? "", /idioma por defecto/i);
});

test("reseña corta con ficha en inglés: si la reseña parece española, gana el español", () => {
  // La detección manda sobre el idioma por defecto, incluso con pocas
  // palabras, si las señales son claras.
  const r = detectarIdioma("muy bueno gracias", "en");
  assert.equal(r.idioma, "es");
  assert.equal(r.confianza, "alta");
});

test("construirPrompt lleva el idioma detectado al redactor", () => {
  const r = reseña("The service was great.");
  const prompt = construirPrompt(r, ficha, { intentos: [] }, "en");
  assert.match(prompt, /Idioma de la respuesta: en/);
});