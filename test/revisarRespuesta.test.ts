// RS.4 — La respuesta que no se puede publicar.
//
// `revisar(texto, ficha)` debe retener (no entregar como lista) cualquier
// respuesta que admita culpa, prometa dinero o un descuento, o afirme un
// dato que no está en la ficha. Una respuesta correcta y sobria pasa.
//
// Este test cubre los 3 puntos del cierre:
//   1. Con un redactor falso que devuelve «le devolvemos su dinero y le
//      regalamos la próxima cena», la respuesta NO se entrega como lista.
//   2. Con uno que inventa un horario o un teléfono que no está en la
//      ficha, tampoco.
//   3. Una respuesta correcta y sobria SÍ pasa: test con 10+ respuestas
//      buenas (producidas con `RedactorFalso` sobre reseñas distintas) y
//      cero rechazos.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generarRespuesta } from "../src/generarRespuesta.js";
import { revisar } from "../src/revisarRespuesta.js";
import { RedactorFalso, type Redactor } from "../src/redactor.js";
import type { ReseñaNegocio } from "../src/convertirReseñas.js";
import type { FichaNegocio } from "../src/fichaNegocio.js";

// ─────────────────────────────────────────────────────────────────────────────
// Ficha de prueba: tiene teléfono, dirección y web conocidos. El nombre es
// "La Esquina", para coincidir con la reseña que ya usa el resto de la suite.
// ─────────────────────────────────────────────────────────────────────────────

const ficha: FichaNegocio = {
  nombre: "La Esquina",
  actividad: "restaurante",
  tono: "cercano",
  contacto: {
    telefono: "555-0100",
    direccion: "Calle Mayor 12",
    web: "laesquina.example",
  },
  ofrece: { gestos: ["repetir el plato"] },
  noOfrece: { gestos: ["devoluciones en efectivo"] },
  // RS.7: idioma por defecto.
  idiomaPorDefecto: "es",
};

// Reseña de 5⭐ reutilizable.
const reseña5: ReseñaNegocio = {
  autor: "Ana",
  texto: "Servicio impecable, volveré pronto.",
  estrellas: 5,
  fecha: "2024-03-01",
  incompleta: false,
  motivo: null,
};

// Reseña de 1⭐ reutilizable.
const reseña1: ReseñaNegocio = {
  autor: "Beto",
  texto: "Tardaron 40 minutos y la comida llegó fría.",
  estrellas: 1,
  fecha: "2024-03-02",
  incompleta: false,
  motivo: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests directos de `revisar(texto, ficha)` — la función pura.
// ─────────────────────────────────────────────────────────────────────────────

test("revisar: respuesta correcta y sobria pasa", () => {
  const ok = revisar("Gracias por su reseña. Le esperamos pronto.", ficha);
  assert.equal(ok.ok, true);
});

test("revisar: texto vacío se rechaza con motivo", () => {
  const r = revisar("   ", ficha);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /vacía/);
});

// ─── Punto 1: admitir culpa / prometer dinero / descuento ─────────────────

test("revisar: 'le devolvemos su dinero' se rechaza con motivo legible", () => {
  const r = revisar(
    "Lamentamos la situación. Le devolvemos su dinero en efectivo.",
    ficha,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /dinero/);
});

test("revisar: 'le regalamos la próxima cena' se rechaza con motivo legible", () => {
  const r = revisar(
    "Lamentamos la experiencia. Le regalamos la próxima cena.",
    ficha,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /regala|invita|pr[óo]xim/);
});

test("revisar: 'le aplicamos un descuento' se rechaza con motivo legible", () => {
  const r = revisar(
    "Gracias por su comentario. Le aplicamos un descuento en su próxima visita.",
    ficha,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /descuento/);
});

test("revisar: 'asumimos toda la responsabilidad' se rechaza con motivo legible", () => {
  const r = revisar(
    "Asumimos toda la responsabilidad por lo ocurrido.",
    ficha,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /responsabilidad|culpa/);
});

// ─── Punto 2: dato inventado (horario / teléfono / web que no está en la ficha)

test("revisar: horario inventado se rechaza con motivo legible", () => {
  const r = revisar(
    "Le esperamos de 9:00 a 22:00 en nuestro local.",
    ficha,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /horario/);
});

test("revisar: teléfono inventado se rechaza con motivo legible", () => {
  const r = revisar(
    "Puede llamarnos al 999-9999 para resolverlo.",
    ficha,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /tel[ée]fono/);
});

test("revisar: web inventada se rechaza con motivo legible", () => {
  const r = revisar(
    "Visite www.otrodominio.com para más información.",
    ficha,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /web|url/i);
});

test("revisar: el teléfono de la ficha SÍ se permite", () => {
  const r = revisar(
    "Puede llamarnos al 555-0100 para cualquier cosa.",
    ficha,
  );
  assert.equal(r.ok, true, `debería haber pasado, fue: ${JSON.stringify(r)}`);
});

test("revisar: la dirección de la ficha SÍ se permite", () => {
  const r = revisar(
    "Le esperamos en Calle Mayor 12 cuando quiera.",
    ficha,
  );
  assert.equal(r.ok, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Punto 1 del cierre integrado con `generarRespuesta` + redactor falso.
// El test usa un redactor que SIEMPRE devuelve una promesa prohibida; la
// respuesta debe llegar como `noDisponible` con motivo que mencione la regla
// que la paró, NO como respuesta lista para pegar.
// ─────────────────────────────────────────────────────────────────────────────

test("generarRespuesta: redactor que promete dinero se retiene (no se entrega como lista)", async () => {
  const redactorMalo: Redactor = {
    async redactar(): Promise<string> {
      return "Lamentamos mucho la situación. Le devolvemos su dinero y le regalamos la próxima cena como compensación.";
    },
  };
  const res = await generarRespuesta(reseña1, ficha, redactorMalo);
  assert.equal(
    "noDisponible" in res,
    true,
    "una respuesta que promete dinero NO debería entregarse como lista",
  );
  if (!("noDisponible" in res)) return;
  assert.equal(res.noDisponible, true);
  assert.match(res.motivo, /ret[ei]da|revisi[óo]n|dinero/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Punto 2 del cierre integrado con `generarRespuesta`.
// ─────────────────────────────────────────────────────────────────────────────

test("generarRespuesta: redactor que inventa horario se retiene", async () => {
  const redactorMalo: Redactor = {
    async redactar(): Promise<string> {
      return "Le esperamos de 8:00 a 24:00 para resolver el problema.";
    },
  };
  const res = await generarRespuesta(reseña1, ficha, redactorMalo);
  assert.equal("noDisponible" in res, true);
  if (!("noDisponible" in res)) return;
  assert.match(res.motivo, /horario/);
});

test("generarRespuesta: redactor que inventa teléfono se retiene", async () => {
  const redactorMalo: Redactor = {
    async redactar(): Promise<string> {
      return "Llámenos al 123-4567 y le atenderemos.";
    },
  };
  const res = await generarRespuesta(reseña1, ficha, redactorMalo);
  assert.equal("noDisponible" in res, true);
  if (!("noDisponible" in res)) return;
  assert.match(res.motivo, /tel[ée]fono/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Punto 3 del cierre: respuestas correctas y sobrias SÍ pasan.
// Test con 10 reseñas distintas, todas de 5⭐ para que el `RedactorFalso`
// produzca respuestas que mencionan "La Esquina" y reflejan el sentimiento
// positivo. Cero rechazos esperado.
// ─────────────────────────────────────────────────────────────────────────────

test("10 respuestas correctas y sobrias pasan la revisión con cero rechazos", async () => {
  const redactor = new RedactorFalso();
  const textos = [
    "Servicio impecable, volveré pronto.",
    "La comida estuvo deliciosa y el trato fue muy amable.",
    "Sin duda el mejor restaurante de la zona, repetiremos.",
    "Buena atención, ambiente agradable y platos generosos.",
    "Todo perfecto, gracias por una velada tan agradable.",
    "El servicio fue rápido y la comida estaba caliente.",
    "Muy recomendable, calidad y trato de primera.",
    "Acudimos por recomendación y no nos defraudó.",
    "Excelente relación calidad-precio, volveremos.",
    "El personal fue muy atento en todo momento.",
  ];
  assert.ok(textos.length >= 10, "el test exige al menos 10 reseñas");

  for (const texto of textos) {
    const reseña: ReseñaNegocio = {
      autor: "Cliente",
      texto,
      estrellas: 5,
      fecha: "2024-04-01",
      incompleta: false,
      motivo: null,
    };
    const res = await generarRespuesta(reseña, ficha, redactor);
    assert.equal(
      "texto" in res,
      true,
      `la respuesta correcta para "${texto}" no debería haberse retenido: ${JSON.stringify(res)}`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Demostración explícita del cableado: si la revisión no se ejecutara, las
// respuestas prohibidas pasarían como `texto`. Esto blinda el test contra
// montajes donde la revisión queda conectada a un cable muerto.
// ─────────────────────────────────────────────────────────────────────────────

test("el cableado es real: sin revisión, una respuesta prohibida SÍ pasaría como texto (control)", async () => {
  const redactorMalo: Redactor = {
    async redactar(): Promise<string> {
      return "Le devolvemos su dinero.";
    },
  };
  // Sin llamar a `generarRespuesta` (que pasa por `revisar`): comprobamos
  // que el redactor suelta el texto prohibido. Esto confirma que el rechazo
  // del test anterior viene de la revisión, no del redactor.
  const directo = await redactorMalo.redactar("prompt");
  assert.match(directo, /dinero/);
  // Y al pasar por `generarRespuesta` se retiene.
  const res = await generarRespuesta(reseña1, ficha, redactorMalo);
  assert.equal("noDisponible" in res, true);
});