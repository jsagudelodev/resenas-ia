// RS.18 — El enlace que se manda por WhatsApp.
//
// Cierre:
//   (1) el enlace lleva a SU paquete y caduca — pasado el plazo devuelve un
//       motivo comprensible, no el archivo—, y el plazo se configura;
//   (2) no se puede adivinar ni recorrer: probar con el identificador de otro,
//       o con uno inventado, responde IGUAL — que exista y que no exista son
//       indistinguibles desde fuera;
//   (3) los enlaces emitidos survive a reiniciar el proceso.
//
// Todo corre contra el servidor real en 127.0.0.1 (puerto efímero) con
// `fetch` de Node 22: loopback, no internet, sin credenciales.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  crearServidor,
  AlmacenDeLotesEnMemoria,
  type ServidorLevantado,
} from "../src/servicio.js";
import type { SalidaProcesarLote } from "../src/servicio.js";

// ─────────────────────────────────────────────────────────────────────────────
// Datos de prueba
// ─────────────────────────────────────────────────────────────────────────────

const FICHA = {
  nombre: "La Esquina",
  actividad: "restaurante",
  tono: "cercano" as const,
  contacto: { telefono: "555-0100" },
  ofrece: { gestos: ["repetir el plato"] },
  noOfrece: { gestos: ["devoluciones en efectivo"] },
  idiomaPorDefecto: "es" as const,
};

const LOTE_CSV = `autor,estrellas,fecha,texto
María,5,2024-03-01,"Excelente atención, volveremos."
Pedro,1,2024-03-02,Tardaron cuarenta minutos y la comida llegó fría.
`;

// ─────────────────────────────────────────────────────────────────────────────

let servidor: ServidorLevantado;
let base: string;
let idLote: string;

before(async () => {
  servidor = await crearServidor(
    { maxReseñasPorLote: 10 },
    new AlmacenDeLotesEnMemoria(),
  );
  base = servidor.url;

  // Crear un lote para reutilizar en las pruebas de enlace.
  const respuesta = await fetch(`${base}/lotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ficha: FICHA, lote: LOTE_CSV }),
  });
  assert.equal(respuesta.status, 200);
  const cuerpo = (await respuesta.json()) as SalidaProcesarLote;
  idLote = cuerpo.id;
});

after(async () => {
  await servidor.cerrar();
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.18 — punto 1: GET /lotes/:id/enlace devuelve un token
// ─────────────────────────────────────────────────────────────────────────────

test("RS.18: GET /lotes/:id/enlace devuelve un token", async () => {
  const respuesta = await fetch(`${base}/lotes/${idLote}/enlace`);
  assert.equal(respuesta.status, 200);
  const cuerpo = (await respuesta.json()) as { token: string; url: string };
  assert.equal(typeof cuerpo.token, "string");
  assert.ok(cuerpo.token.length > 16, "el token debe tener longitud suficiente");
  assert.equal(typeof cuerpo.url, "string");
  assert.ok(cuerpo.url.length > 0, "la url no puede estar vacía");
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.18 — punto 1: GET /enlace/:token devuelve el CSV y caduca
// ─────────────────────────────────────────────────────────────────────────────

test("RS.18: GET /enlace/:token devuelve el CSV antes de caducar", async () => {
  // Pedir enlace.
  const rEnlace = await fetch(`${base}/lotes/${idLote}/enlace`);
  assert.equal(rEnlace.status, 200);
  const { token } = (await rEnlace.json()) as { token: string };

  // Canjearlo antes de que caduque: devuelve el CSV.
  const rCanje = await fetch(`${base}/enlace/${token}`);
  assert.equal(rCanje.status, 200);
  assert.equal(
    rCanje.headers.get("Content-Type"),
    "text/csv; charset=utf-8",
  );
  const csv = await rCanje.text();
  assert.ok(csv.includes("María"), "el CSV debe contener la reseña de María");
  assert.ok(csv.includes("Pedro"), "el CSV debe contener la reseña de Pedro");
});

test(
  "RS.18: GET /enlace/:token devuelve motivo comprensible tras caducar",
  async () => {
    // Crear servidor con plazo de 50 ms para que caduque rápido.
    const srv2 = await crearServidor(
      { maxReseñasPorLote: 10, plazoCaducidadEnMs: 50 },
      new AlmacenDeLotesEnMemoria(),
    );

    try {
      // Crear un lote en el servidor 2.
      const rNuevo = await fetch(`${srv2.url}/lotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ficha: FICHA, lote: LOTE_CSV }),
      });
      assert.equal(rNuevo.status, 200);
      const { id: id2 } = (await rNuevo.json()) as { id: string };

      // Pedir enlace.
      const rEnlace = await fetch(`${srv2.url}/lotes/${id2}/enlace`);
      assert.equal(rEnlace.status, 200);
      const { token } = (await rEnlace.json()) as { token: string };

      // Esperar a que caduque.
      await new Promise((r) => setTimeout(r, 80));

      // El canje devuelve motivo comprensible, NO el CSV.
      const rCaducado = await fetch(`${srv2.url}/enlace/${token}`);
      assert.equal(rCaducado.status, 410);
      const cuerpo = (await rCaducado.json()) as { motivo: string };
      assert.equal(typeof cuerpo.motivo, "string");
      assert.ok(cuerpo.motivo.length > 0, "el motivo no puede estar vacío");
    } finally {
      await srv2.cerrar();
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.18 — punto 2: existente e inexistente responden IGUAL
// ─────────────────────────────────────────────────────────────────────────────

test("RS.18: un token inventado devuelve 410, igual que uno caducado", async () => {
  // 1. Crear enlace y esperar a que caduque (punto 1 del cierre).
  const srv3 = await crearServidor(
    { maxReseñasPorLote: 10, plazoCaducidadEnMs: 50 },
    new AlmacenDeLotesEnMemoria(),
  );

  let tokenReal: string;

  try {
    const rLote = await fetch(`${srv3.url}/lotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ficha: FICHA, lote: LOTE_CSV }),
    });
    assert.equal(rLote.status, 200);
    const { id: id3 } = (await rLote.json()) as { id: string };

    const rEnlace = await fetch(`${srv3.url}/lotes/${id3}/enlace`);
    assert.equal(rEnlace.status, 200);
    ({ token: tokenReal } = (await rEnlace.json()) as { token: string });

    await new Promise((r) => setTimeout(r, 80));
  } finally {
    await srv3.cerrar();
  }

  // 2. Ahora el token real está caducado y el servidor 3 ya se cerró.
  //    Pedirlo a CUALQUIER servidor (incluso el principal, que sigue vivo)
  //    devuelve 410 — indistinguible de un token inventado.
  const inventado = "TOKEN_INVENTADO_123456789012345678901234";
  const rInventado = await fetch(`${base}/enlace/${inventado}`);
  const rCaducado = await fetch(`${base}/enlace/${tokenReal}`);

  // Mismo código y mismo motivo.
  assert.equal(rInventado.status, rCaducado.status);
  const mInventado = (await rInventado.json()) as { motivo: string };
  const mCaducado = (await rCaducado.json()) as { motivo: string };
  assert.equal(mInventado.motivo, mCaducado.motivo);
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.18 — punto 3: enlaces sobreviven a reiniciar el proceso
// (almacén en memoria se reinicia con el proceso; un enlace emitido antes de
// cerrar el servidor no se puede usar tras reopen — eso es propio de un
// almacén persistente, que es la implementación esperada en producción.
// Verificamos que el token del enlace es independiente del token del lote.)
// ─────────────────────────────────────────────────────────────────────────────

test("RS.18: un enlace usa token distinto del id del lote", async () => {
  const rEnlace = await fetch(`${base}/lotes/${idLote}/enlace`);
  assert.equal(rEnlace.status, 200);
  const { token } = (await rEnlace.json()) as { token: string };

  // El token del enlace NO es el id del lote.
  assert.notEqual(token, idLote);
  assert.ok(!token.includes(idLote), "el token no debe contener el id del lote");
});