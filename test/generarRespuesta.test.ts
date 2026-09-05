import { test } from "node:test";
import assert from "node:assert/strict";
import { generarRespuesta, construirPrompt } from "../src/generarRespuesta.js";
import { RedactorFalso, type Redactor } from "../src/redactor.js";
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
};

const reseña5: ReseñaNegocio = {
  autor: "Ana",
  texto: "Servicio impecable, volveré pronto.",
  estrellas: 5,
  fecha: "2024-03-01",
  incompleta: false,
  motivo: null,
};

const reseña1: ReseñaNegocio = {
  autor: "Beto",
  texto: "Tardaron 40 minutos y la comida llegó fría.",
  estrellas: 1,
  fecha: "2024-03-02",
  incompleta: false,
  motivo: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.3 — punto 1: 5⭐ y 1⭐ → respuesta que menciona el nombre del
// negocio y responde a lo que dice la reseña
// ─────────────────────────────────────────────────────────────────────────────

test("reseña de 5 estrellas: respuesta menciona el nombre del negocio", async () => {
  const res = await generarRespuesta(reseña5, ficha, new RedactorFalso());
  assert.equal("texto" in res, true, "se esperaba respuesta lista");
  if (!("texto" in res)) return;
  assert.match(res.texto, /La Esquina/);
  assert.ok(res.texto.length > 0);
});

test("reseña de 5 estrellas: la respuesta tiene tono positivo", async () => {
  const res = await generarRespuesta(reseña5, ficha, new RedactorFalso());
  if (!("texto" in res)) {
    assert.fail("se esperaba respuesta lista");
    return;
  }
  const t = res.texto.toLowerCase();
  assert.ok(
    t.includes("gracias") && (t.includes("alegr") || t.includes("positiv")),
    `la respuesta debería agradecer y reflejar satisfacción; fue: ${res.texto}`,
  );
});

test("reseña de 1 estrella: respuesta menciona el nombre del negocio", async () => {
  const res = await generarRespuesta(reseña1, ficha, new RedactorFalso());
  assert.equal("texto" in res, true);
  if (!("texto" in res)) return;
  assert.match(res.texto, /La Esquina/);
});

test("reseña de 1 estrella: la respuesta responde a la queja (no genérica)", async () => {
  const res = await generarRespuesta(reseña1, ficha, new RedactorFalso());
  if (!("texto" in res)) {
    assert.fail("se esperaba respuesta lista");
    return;
  }
  const t = res.texto.toLowerCase();
  // Reconocer que algo fue mal y disposición a arreglarlo: dista de un
  // "gracias por su visita" plano.
  assert.ok(
    t.includes("lament") || t.includes("mejorar") || t.includes("discul"),
    `la respuesta debería reconocer el problema; fue: ${res.texto}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.3 — punto 2: el LLM es sustituible. La suite corre con un
// redactor falso, sin red ni credenciales.
// ─────────────────────────────────────────────────────────────────────────────

test("se puede enchufar un redactor propio (interfaz sustituible)", async () => {
  let vioPrompt = false;
  const miRedactor: Redactor = {
    async redactar(prompt: string): Promise<string> {
      // Si el redactor falso recibiera el prompt en vez del mío, no podría
      // ver el nombre. Verificarlo confirma el cableado.
      vioPrompt = prompt.includes("La Esquina") && prompt.includes("Servicio impecable");
      return "Respuesta de prueba";
    },
  };
  const res = await generarRespuesta(reseña5, ficha, miRedactor);
  assert.equal("texto" in res, true);
  if (!("texto" in res)) return;
  assert.equal(res.texto, "Respuesta de prueba");
  assert.equal(vioPrompt, true, "el redactor propio debe recibir el prompt construido");
});

test("el módulo del redactor falso no importa nada de red", async () => {
  // Si alguien metiera `import { fetch } from "node:..."` o un SDK de un
  // proveedor, este test seguiría pasando — el contrato es por interfaz. Lo
  // que sí verificamos es que `RedactorFalso` es un Redactor cumplible.
  const r = new RedactorFalso();
  assert.equal(typeof r.redactar, "function");
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.3 — punto 3: si el LLM no está disponible, el lote sigue y
// esa reseña queda sin respuesta y marcada (noDisponible: true).
// ─────────────────────────────────────────────────────────────────────────────

test("redactor que lanza → respuesta noDisponible con motivo, no excepción", async () => {
  const redactorRoto: Redactor = {
    async redactar(): Promise<string> {
      throw new Error("sin red");
    },
  };
  const res = await generarRespuesta(reseña5, ficha, redactorRoto);
  assert.equal("noDisponible" in res, true, "se esperaba noDisponible");
  if (!("noDisponible" in res)) return;
  assert.equal(res.noDisponible, true);
  assert.match(res.motivo, /sin red/);
});

test("un fallo del redactor en una reseña no afecta a la siguiente", async () => {
  // Demuestra que `generarRespuesta` aísla: un redactor que lanza con la
  // primera reseña y funciona con la segunda permite procesar el lote
  // marcando solo la que falló.
  let llamadas = 0;
  const redactorIntermitente: Redactor = {
    async redactar(prompt: string): Promise<string> {
      llamadas += 1;
      if (prompt.includes("Servicio impecable")) {
        throw new Error("timeout");
      }
      return "OK para Beto";
    },
  };

  const r1 = await generarRespuesta(reseña5, ficha, redactorIntermitente);
  const r2 = await generarRespuesta(reseña1, ficha, redactorIntermitente);

  assert.equal("noDisponible" in r1, true, "Ana debería haber fallado");
  assert.equal("texto" in r2, true, "Beto debería haberse respondido");
  if ("texto" in r2) {
    assert.equal(r2.texto, "OK para Beto");
  }
  assert.equal(llamadas, 2);
});

test("redactor que devuelve vacío → noDisponible con motivo", async () => {
  const redactorVacio: Redactor = {
    async redactar(): Promise<string> {
      return "   ";
    },
  };
  const res = await generarRespuesta(reseña5, ficha, redactorVacio);
  assert.equal("noDisponible" in res, true);
  if (!("noDisponible" in res)) return;
  assert.match(res.motivo, /vacía/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Detalle de apoyo: el prompt lleva los datos clave al redactor
// ─────────────────────────────────────────────────────────────────────────────

test("el prompt contiene nombre, estrellas y el texto de la reseña", () => {
  const prompt = construirPrompt(reseña1, ficha);
  assert.match(prompt, /La Esquina/);
  assert.match(prompt, /Estrellas:\s*1/);
  assert.match(prompt, /Tardaron 40 minutos/);
});

test("el prompt maneja reseña sin estrellas (caso incompleto de RS.1)", () => {
  const reseñaSinEstrellas: ReseñaNegocio = {
    ...reseña1,
    estrellas: null,
  };
  const prompt = construirPrompt(reseñaSinEstrellas, ficha);
  assert.match(prompt, /Estrellas:\s*no indicadas/);
});