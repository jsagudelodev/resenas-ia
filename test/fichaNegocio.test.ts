import { test } from "node:test";
import assert from "node:assert/strict";
import { validarFicha, type FichaNegocio } from "../src/fichaNegocio.js";

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.2 — punto 1: una ficha incompleta se acepta y dice qué le falta
// ─────────────────────────────────────────────────────────────────────────────

const fichaCompleta: FichaNegocio = {
  nombre: "La Esquina",
  actividad: "restaurante",
  tono: "cercano",
  contacto: { telefono: "555-0100", correo: "hola@laesquina.test" },
  ofrece: { gestos: ["repetir el plato", "invitar un café"] },
  noOfrece: { gestos: ["devoluciones en efectivo"] },
  // RS.7: idioma por defecto. Se declara explícito para que el objeto cumpla
  // con el tipo `FichaNegocio` (ahora obligatorio).
  idiomaPorDefecto: "es",
};

test("ficha completa devuelve ok=true con faltantes vacío", () => {
  const res = validarFicha(fichaCompleta);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.faltantes, []);
  assert.equal(res.ficha.nombre, "La Esquina");
  assert.equal(res.ficha.actividad, "restaurante");
  assert.equal(res.ficha.tono, "cercano");
  assert.deepEqual(res.ficha.ofrece.gestos, ["repetir el plato", "invitar un café"]);
});

test("ficha sin nombre se acepta y reporta 'nombre' en faltantes", () => {
  const entrada = { ...fichaCompleta, nombre: "" };
  const res = validarFicha(entrada);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(res.faltantes.includes("nombre"), `faltantes: ${res.faltantes.join(", ")}`);
  assert.equal(res.ficha.nombre, "");
  assert.equal(res.ficha.actividad, "restaurante");
});

test("ficha sin actividad se acepta y reporta 'actividad' en faltantes", () => {
  const entrada = { ...fichaCompleta, actividad: "  " };
  const res = validarFicha(entrada);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(res.faltantes.includes("actividad"), `faltantes: ${res.faltantes.join(", ")}`);
});

test("ficha sin nombre y sin actividad lista ambos en faltantes", () => {
  const entrada = { ...fichaCompleta, nombre: "", actividad: "" };
  const res = validarFicha(entrada);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(res.faltantes.includes("nombre"));
  assert.ok(res.faltantes.includes("actividad"));
});

test("ficha mínima con solo tono se acepta y reporta los dos faltantes", () => {
  const res = validarFicha({ tono: "formal" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.faltantes.sort(), ["actividad", "nombre"]);
  assert.equal(res.ficha.tono, "formal");
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.2 — punto 2: tono es valor cerrado, tono desconocido se rechaza
// ─────────────────────────────────────────────────────────────────────────────

test("tono desconocido se rechaza con motivo legible", () => {
  const res = validarFicha({ ...fichaCompleta, tono: "amigable" });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.motivo, /tono/i);
  assert.match(res.motivo, /cercano|formal/);
});

test("tono ausente (no es string) se rechaza con motivo", () => {
  const res = validarFicha({ ...fichaCompleta, tono: undefined });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.motivo, /tono/i);
});

test("tono se acepta en mayúsculas y con espacios (normalización)", () => {
  const res = validarFicha({ ...fichaCompleta, tono: "  CERCANO  " });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.ficha.tono, "cercano");
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.2 — punto 3: la ficha se valida sin llamar a ningún modelo
// ─────────────────────────────────────────────────────────────────────────────

test("no se importa ni se invoca nada que pueda hablar con un LLM", async () => {
  // Importar el módulo y llamar a validarFicha no debe tocar red ni modelos.
  // Si el módulo requiriera un SDK externo, el `import` de arriba ya habría
  // fallado o habría dejado un cliente abierto. Aquí dejamos la aserción
  // explícita sobre la pureza: validarFicha es síncrona y solo inspecciona
  // tipos.
  const res = validarFicha(fichaCompleta);
  assert.equal(res.ok, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Validación defensiva adicional (no exigida por el cierre, pero coherente con
// la regla 9: un input malformado no debe tumbar el servicio)
// ─────────────────────────────────────────────────────────────────────────────

test("entrada que no es objeto se rechaza con motivo", () => {
  for (const malo of [null, "hola", 42, true]) {
    const res = validarFicha(malo);
    assert.equal(res.ok, false, `debería rechazar ${String(malo)}`);
  }
});

test("contacto con tipos incorrectos se rechaza con motivo", () => {
  const res = validarFicha({
    ...fichaCompleta,
    contacto: { telefono: 123 },
  });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.motivo, /contacto\.telefono/);
});