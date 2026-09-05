// RS.11 — Ahora el negocio tiene varias sucursales.
//
// Cierre: (1) dos reseñas de sucursales distintas producen respuestas con la
// firma de cada una; (2) los lotes ya guardados ANTES de este ítem se siguen
// leyendo y devuelven lo mismo que devolvían; (3) la suite entera sigue verde
// y ningún test existente se ha tocado.
//
// Los tres puntos se prueban sobre la base ya disponible (RS.3, RS.8, RS.10)
// con un redactor falso —sin red ni credenciales (regla 7)— y con la ficha
// validada por `validarFicha` (RS.2). No se añaden dependencias.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { validarFicha, type FichaNegocio } from "../src/fichaNegocio.js";
import { construirPrompt } from "../src/generarRespuesta.js";
import { RedactorFalso, type Redactor } from "../src/redactor.js";
import { procesarLote } from "../src/procesarLote.js";
import type { ReseñaNegocio } from "../src/convertirReseñas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Datos comunes
// ─────────────────────────────────────────────────────────────────────────────

/** Ficha SIN sucursal: idéntica a la que usaban los tests anteriores a
 *  RS.11. Sirve para comprobar que el prompt no cambia cuando no hay
 *  sucursal (punto 2 del cierre). */
const fichaSinSucursal: FichaNegocio = {
  nombre: "La Esquina",
  actividad: "restaurante",
  tono: "cercano",
  contacto: { telefono: "555-0100" },
  ofrece: { gestos: ["repetir el plato"] },
  noOfrece: { gestos: ["devoluciones en efectivo"] },
  idiomaPorDefecto: "es",
};

/** Ficha con sucursal Centro. */
const fichaCentro: FichaNegocio = {
  ...fichaSinSucursal,
  sucursal: {
    nombre: "La Esquina Centro",
    direccion: "Av. Reforma 123",
    encargado: "Lucía Pérez",
  },
};

/** Ficha con sucursal Norte. */
const fichaNorte: FichaNegocio = {
  ...fichaSinSucursal,
  sucursal: {
    nombre: "La Esquina Norte",
    direccion: "Calle 5 de Mayo 45",
    encargado: "Carlos Ruiz",
  },
};

function reseña(autor: string, texto: string, estrellas: number): ReseñaNegocio {
  return {
    autor,
    texto,
    estrellas,
    fecha: "2024-03-01",
    incompleta: false,
    motivo: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.11 — punto 1: dos sucursales distintas firman cada respuesta
// ─────────────────────────────────────────────────────────────────────────────

test("RS.11 punto 1: dos sucursales distintas producen respuestas con la firma de cada una", async () => {
  // Cada lote es de UNA sucursal: la ficha se procesa contra su lote. El
  // redactor falso firma con el "Nombre del negocio:" del prompt, que ahora
  // es el nombre de la sucursal.
  const loteCentro = [reseña("Ana", "Excelente atención, volveré.", 5)];
  const loteNorte = [reseña("Beto", "El servicio fue regular.", 3)];

  const loteCentroRes = await procesarLote(loteCentro, fichaCentro, new RedactorFalso());
  const loteNorteRes = await procesarLote(loteNorte, fichaNorte, new RedactorFalso());

  // Cada lote tiene UNA respuesta y cada respuesta menciona el nombre de
  // SU sucursal — no el de la otra, ni el genérico.
  assert.equal(loteCentroRes.resultados.length, 1);
  assert.equal(loteNorteRes.resultados.length, 1);

  const resCentro = loteCentroRes.resultados[0];
  const resNorte = loteNorteRes.resultados[0];
  assert.ok(resCentro !== undefined);
  assert.ok(resNorte !== undefined);
  assert.equal("texto" in resCentro, true, "Centro esperaba respuesta lista");
  assert.equal("texto" in resNorte, true, "Norte esperaba respuesta lista");
  if (!("texto" in resCentro)) return;
  if (!("texto" in resNorte)) return;

  assert.match(
    resCentro.texto,
    /La Esquina Centro/,
    `la respuesta de Centro debe llevar el nombre de la sucursal; fue: ${resCentro.texto}`,
  );
  assert.doesNotMatch(
    resCentro.texto,
    /La Esquina Norte/,
    `la respuesta de Centro no debe llevar el nombre de la otra sucursal; fue: ${resCentro.texto}`,
  );
  assert.match(
    resNorte.texto,
    /La Esquina Norte/,
    `la respuesta de Norte debe llevar el nombre de la sucursal; fue: ${resNorte.texto}`,
  );
  assert.doesNotMatch(
    resNorte.texto,
    /La Esquina Centro/,
    `la respuesta de Norte no debe llevar el nombre de la otra sucursal; fue: ${resNorte.texto}`,
  );
});

test("RS.11 punto 1: el prompt incluye la dirección y el encargado cuando están en la ficha", () => {
  const r = reseña("Ana", "Buen servicio", 5);
  const prompt = construirPrompt(r, fichaCentro, { intentos: [] }, "es");
  assert.match(prompt, /Nombre del negocio: La Esquina Centro/);
  assert.match(prompt, /Dirección de la sucursal: Av\. Reforma 123/);
  assert.match(prompt, /Encargado de la sucursal: Lucía Pérez/);
});

test("RS.11 punto 1: validarFicha acepta una ficha con sucursal completa", () => {
  const res = validarFicha(fichaCentro);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.faltantes, []);
  assert.ok(res.ficha.sucursal !== undefined, "la ficha validada debe llevar la sucursal");
  if (res.ficha.sucursal === undefined) return;
  assert.equal(res.ficha.sucursal.nombre, "La Esquina Centro");
  assert.equal(res.ficha.sucursal.direccion, "Av. Reforma 123");
  assert.equal(res.ficha.sucursal.encargado, "Lucía Pérez");
});

test("RS.11 punto 1: validarFicha rechaza una sucursal sin nombre", () => {
  const res = validarFicha({ ...fichaCentro, sucursal: { direccion: "Av. Reforma 123" } });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.motivo, /sucursal\.nombre/);
});

test("RS.11 punto 1: validarFicha rechaza un campo 'sucursal' que no es objeto", () => {
  const res = validarFicha({ ...fichaCentro, sucursal: "Centro" });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.motivo, /sucursal/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.11 — punto 2: los lotes guardados antes de este ítem se siguen
// leyendo. La forma más sólida de probarlo es afirmar que el prompt de una
// reseña con la ficha VIEJA (sin sucursal) produce la MISMA clave sha256 que
// producía antes del refactor. Como la clave es sha256 del prompt y el prompt
// es determinista, basta con comparar contra el valor conocido.
// ─────────────────────────────────────────────────────────────────────────────

test("RS.11 punto 2: una ficha sin sucursal produce el mismo prompt que antes", () => {
  // Misma reseña y ficha que las pruebas anteriores a RS.11 (p. ej.
  // `test/almacenRespuestas.test.ts` y `test/generarRespuesta.test.ts`).
  const r = reseña("Ana", "Buen servicio", 5);
  const prompt = construirPrompt(r, fichaSinSucursal, { intentos: [] }, "es");

  // El prompt viejo NO contenía las líneas de sucursal: las líneas
  // adicionales solo se añaden cuando la ficha lleva `sucursal`.
  assert.doesNotMatch(prompt, /sucursal/i, "una ficha sin sucursal no debe añadir líneas de sucursal al prompt");

  // Y la línea de firma sigue siendo la genérica.
  assert.match(prompt, /Nombre del negocio: La Esquina\b/);

  // La clave sha256 esperada es la que produciría una implementación que
  // NO conoce sucursales (la misma que tenía la suite antes de RS.11). Si
  // cambiara, los lotes guardados quedarían huérfanos. El valor se fija
  // aquí: cualquier refactor que mueva el orden o las líneas del prompt
  // viejo lo romperá — y ese es el punto: que se note.
  const esperada = "1454bb7a79a3afbb71e4864b236802f865f9314cad8e855da6a8fbfdce2290b3";
  const actual = createHash("sha256").update(prompt, "utf8").digest("hex");
  assert.equal(actual, esperada, "la clave del prompt viejo debe seguir siendo la misma para que la caché sobreviva");
});

test("RS.11 punto 2: una ficha con sucursal produce una clave DISTINTA (invalida la caché anterior a propósito)", () => {
  const r = reseña("Ana", "Buen servicio", 5);
  const promptViejo = construirPrompt(r, fichaSinSucursal, { intentos: [] }, "es");
  const promptNuevo = construirPrompt(r, fichaCentro, { intentos: [] }, "es");
  assert.notEqual(promptViejo, promptNuevo);
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.11 — punto 3: la suite entera sigue verde y ningún test
// existente se ha tocado. Eso se comprueba con `npm test` (no en este
// archivo): aquí se añade un test que ejercita el camino "sin tocar
// pruebas viejas" — usar el redactor propio de la suite, no uno nuevo, y
// usar la misma forma de validarFicha que ya usaban los demás tests.
// ─────────────────────────────────────────────────────────────────────────────

test("RS.11 punto 3: el redactor propio puede firmar con el nombre de la sucursal", async () => {
  // Redactor que firma con el "Nombre del negocio:" que lee del prompt.
  // Si el cableado de `construirPrompt` con la ficha de sucursal funciona,
  // este redactor verá el nombre de la sucursal.
  let firmaVista = "";
  const firmador: Redactor = {
    async redactar(prompt: string): Promise<string> {
      const m = /Nombre del negocio:\s*([^\n]+)/.exec(prompt);
      firmaVista = m?.[1] ?? "";
      return "ok";
    },
  };

  await procesarLote(
    [reseña("Ana", "Buen servicio", 5)],
    fichaNorte,
    firmador,
  );
  assert.equal(firmaVista, "La Esquina Norte");
});