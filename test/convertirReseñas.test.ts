import { test } from "node:test";
import assert from "node:assert/strict";
import { convertirReseñas } from "../src/convertirReseñas.js";

// Lote "canónico" usado por los tests 1–2: la misma información expresada en
// CSV y en texto pegado. Punto 1 del cierre de RS.1: ambas formas producen la
// misma lista.
const loteCSV =
  "autor,estrellas,fecha,texto\n" +
  "Ana,5,2024-03-01,Servicio impecable.\n" +
  "Beto,1,2024-03-02,Tardaron 40 minutos.\n";

const loteTexto =
  "Autor: Ana\n" +
  "Estrellas: 5\n" +
  "Fecha: 2024-03-01\n" +
  "Servicio impecable.\n" +
  "\n" +
  "Autor: Beto\n" +
  "Estrellas: 1\n" +
  "Fecha: 2024-03-02\n" +
  "Tardaron 40 minutos.\n";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Mismo lote en CSV y en texto pegado produce la misma lista
// ─────────────────────────────────────────────────────────────────────────────

test("CSV: dos reseñas bien formadas producen la lista esperada", () => {
  const salida = convertirReseñas(loteCSV);
  assert.equal(salida.errores.length, 0);
  assert.equal(salida.reseñas.length, 2);

  const ana = salida.reseñas[0];
  const beto = salida.reseñas[1];
  assert.equal(ana?.autor, "Ana");
  assert.equal(ana?.estrellas, 5);
  assert.equal(ana?.fecha, "2024-03-01");
  assert.equal(ana?.texto, "Servicio impecable.");
  assert.equal(ana?.incompleta, false);
  assert.equal(ana?.motivo, null);

  assert.equal(beto?.autor, "Beto");
  assert.equal(beto?.estrellas, 1);
  assert.equal(beto?.fecha, "2024-03-02");
  assert.equal(beto?.texto, "Tardaron 40 minutos.");
  assert.equal(beto?.incompleta, false);
});

test("texto pegado: el mismo lote que el CSV produce la misma lista", () => {
  const salida = convertirReseñas(loteTexto);
  assert.equal(salida.errores.length, 0);
  assert.equal(salida.reseñas.length, 2);

  const ana = salida.reseñas[0];
  const beto = salida.reseñas[1];
  assert.equal(ana?.autor, "Ana");
  assert.equal(ana?.estrellas, 5);
  assert.equal(ana?.fecha, "2024-03-01");
  assert.equal(ana?.texto, "Servicio impecable.");

  assert.equal(beto?.autor, "Beto");
  assert.equal(beto?.estrellas, 1);
  assert.equal(beto?.fecha, "2024-03-02");
  assert.equal(beto?.texto, "Tardaron 40 minutos.");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Reseña sin estrellas o sin fecha entra marcada, no descartada
// ─────────────────────────────────────────────────────────────────────────────

test("texto pegado: sin estrellas entra marcada como incompleta, no se descarta", () => {
  const texto =
    "Autor: Carla\n" +
    "Fecha: 2024-04-10\n" +
    "La comida estaba rica.\n";
  const salida = convertirReseñas(texto);
  assert.equal(salida.errores.length, 0);
  assert.equal(salida.reseñas.length, 1);
  const carla = salida.reseñas[0];
  assert.equal(carla?.autor, "Carla");
  assert.equal(carla?.estrellas, null);
  assert.equal(carla?.fecha, "2024-04-10");
  assert.equal(carla?.texto, "La comida estaba rica.");
  assert.equal(carla?.incompleta, true);
  assert.match(carla?.motivo ?? "", /estrellas/i);
});

test("texto pegado: sin fecha entra marcada como incompleta, no se descarta", () => {
  const texto =
    "Autor: David\n" +
    "Estrellas: 4\n" +
    "Buen trato del personal.\n";
  const salida = convertirReseñas(texto);
  assert.equal(salida.errores.length, 0);
  assert.equal(salida.reseñas.length, 1);
  const david = salida.reseñas[0];
  assert.equal(david?.autor, "David");
  assert.equal(david?.estrellas, 4);
  assert.equal(david?.fecha, null);
  assert.equal(david?.incompleta, true);
  assert.match(david?.motivo ?? "", /fecha/i);
});

test("CSV: sin estrellas y sin fecha entra marcada, no se descarta", () => {
  const csv =
    "autor,estrellas,fecha,texto\n" +
    "Elena,,,Solo fui una vez y me gustó.\n";
  const salida = convertirReseñas(csv);
  assert.equal(salida.errores.length, 0);
  assert.equal(salida.reseñas.length, 1);
  const elena = salida.reseñas[0];
  assert.equal(elena?.autor, "Elena");
  assert.equal(elena?.estrellas, null);
  assert.equal(elena?.fecha, null);
  assert.equal(elena?.texto, "Solo fui una vez y me gustó.");
  assert.equal(elena?.incompleta, true);
  assert.match(elena?.motivo ?? "", /estrellas|fecha/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Entrada no interpretable: motivo comprensible, no excepción desnuda
// ─────────────────────────────────────────────────────────────────────────────

test("entrada vacía: lanza con un motivo comprensible", () => {
  assert.throws(
    () => convertirReseñas(""),
    /vac[ií]a|sin rese/i,
  );
});

test("entrada irreconocible: lanza con un motivo comprensible, no excepción desnuda", () => {
  assert.throws(
    () => convertirReseñas("$$$@@@###!!!"),
    /RS\.1|no (se )?reconoci|csv|texto/i,
  );
});

test("CSV con fila irreconocible: la fila se reporta con motivo y las demás siguen", () => {
  const csv =
    "autor,estrellas,fecha,texto\n" +
    "Fer,3,2024-05-01,Bien.\n" +
    "fila rota sin comas ni sentido\n" +
    "Gala,5,2024-05-02,Genial.\n";
  const salida = convertirReseñas(csv);
  // Las dos reseñas legibles entran.
  assert.equal(salida.reseñas.length, 2);
  assert.equal(salida.reseñas[0]?.autor, "Fer");
  assert.equal(salida.reseñas[1]?.autor, "Gala");
  // Y la fila rota queda como error con motivo comprensible.
  assert.equal(salida.errores.length, 1);
  assert.equal(salida.errores[0]?.indice, 2);
  assert.match(salida.errores[0]?.motivo ?? "", /columnas|formato/i);
});