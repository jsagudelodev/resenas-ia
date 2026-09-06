// RS.14 — Subir el lote y recibir el paquete.
//
// Cierre: (1) POST con el lote y la ficha devuelve el resumen y un
// identificador para descargar el paquete; (2) un lote vacío o corrupto
// devuelve un motivo comprensible y NO tumba el servicio; (3) el número
// máximo de reseñas por lote se configura.
//
// Todo el test corre contra el servidor real en 127.0.0.1 (puerto efímero)
// con `fetch` de Node 22: loopback, no internet, sin credenciales.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  crearServidor,
  AlmacenDeLotesEnMemoria,
  MAX_RESEÑAS_POR_LOTE_DEFECTO,
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
Ana,3,2024-03-03,Sin comentarios.
`;

const FICHA_FALTANTE = {
  // Falta `actividad` a propósito: la ficha debe aceptarse y reportar
  // faltantes sin rechazar (punto 1 de RS.2).
  nombre: "La Esquina",
  tono: "cercano" as const,
  contacto: {},
  ofrece: { gestos: [] },
  noOfrece: { gestos: [] },
  idiomaPorDefecto: "es" as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Servidor: uno por archivo, con tope bajo para que el test del punto 3
// pueda demostrar que un lote grande se rechaza con motivo.
// ─────────────────────────────────────────────────────────────────────────────

let servidor: ServidorLevantado;
let base: string;

before(async () => {
  servidor = await crearServidor(
    { maxReseñasPorLote: 3 },
    new AlmacenDeLotesEnMemoria(),
  );
  base = servidor.url;
});

after(async () => {
  await servidor.cerrar();
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.14 — punto 1: POST devuelve resumen + id + paquete por GET
// ─────────────────────────────────────────────────────────────────────────────

test("RS.14: POST /lotes devuelve id, resumen, conteos y el paquete se descarga por GET", async () => {
  const respuesta = await fetch(`${base}/lotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ficha: FICHA, lote: LOTE_CSV }),
  });

  assert.equal(respuesta.status, 200);
  const cuerpo = (await respuesta.json()) as SalidaProcesarLote;

  // Identificador presente.
  assert.equal(typeof cuerpo.id, "string");
  assert.ok(cuerpo.id.length > 0, "el id no puede estar vacío");

  // Conteos del lote (punto 1: el lote dice cuántas quedaron listas, cuántas
  // para revisión y cuántas fallaron, RS.8).
  assert.equal(cuerpo.conteos.listas + cuerpo.conteos.paraRevision + cuerpo.conteos.fallaron, 3);

  // Resumen presente: la forma es la de RS.9.
  assert.equal(typeof cuerpo.resumen, "object");
  assert.equal(typeof cuerpo.resumen.totalReseñas, "number");
  assert.equal(cuerpo.resumen.totalReseñas, 3);
  assert.ok(Array.isArray(cuerpo.resumen.motivos));
  assert.equal(typeof cuerpo.resumen.umbralMinimo, "number");

  // La ficha incompleta se acepta y se reporta (punto 1 de RS.2).
  const fichaIncompleta = await fetch(`${base}/lotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ficha: FICHA_FALTANTE, lote: LOTE_CSV }),
  });
  assert.equal(fichaIncompleta.status, 200);
  const cuerpoIncompleto = (await fichaIncompleta.json()) as SalidaProcesarLote;
  assert.ok(cuerpoIncompleto.fichaFaltantes.length > 0,
    "una ficha sin actividad debe listar 'actividad' como faltante");
  assert.ok(cuerpoIncompleto.fichaFaltantes.some((f) => f.includes("actividad")),
    `fichaFaltantes debe mencionar 'actividad'; recibido: ${JSON.stringify(cuerpoIncompleto.fichaFaltantes)}`);

  // El paquete se descarga por GET con el id.
  const paquete = await fetch(`${base}/lotes/${cuerpo.id}/paquete`);
  assert.equal(paquete.status, 200);
  const contentType = paquete.headers.get("content-type") ?? "";
  assert.match(contentType, /text\/csv/);
  const csv = await paquete.text();
  // El CSV arranca con la cabecera de RS.12 y tiene filas.
  assert.ok(csv.length > 0);
  assert.ok(csv.includes("indice"));
  assert.ok(csv.includes("autor"));
  assert.ok(csv.includes("estado"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.14 — punto 2: lote vacío o corrupto no tumba el servicio
// ─────────────────────────────────────────────────────────────────────────────

test("RS.14: un lote vacío devuelve 400 con motivo y el servicio sigue", async () => {
  const r1 = await fetch(`${base}/lotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ficha: FICHA, lote: "" }),
  });
  assert.equal(r1.status, 400);
  const cuerpo1 = (await r1.json()) as { motivo: string };
  assert.equal(typeof cuerpo1.motivo, "string");
  assert.ok(cuerpo1.motivo.length > 0);

  // Tras el fallo, el servicio sigue respondiendo.
  const r2 = await fetch(`${base}/lotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ficha: FICHA, lote: LOTE_CSV }),
  });
  assert.equal(r2.status, 200);
  const ok2 = (await r2.json()) as SalidaProcesarLote;
  assert.equal(typeof ok2.id, "string");
});

test("RS.14: un lote corrupto devuelve 400 con motivo y el servicio sigue", async () => {
  const r1 = await fetch(`${base}/lotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ficha: FICHA, lote: "basura sin formato conocido" }),
  });
  assert.equal(r1.status, 400);
  const cuerpo1 = (await r1.json()) as { motivo: string };
  assert.equal(typeof cuerpo1.motivo, "string");
  assert.ok(cuerpo1.motivo.length > 0);

  // JSON malformado: también es motivo, no excepción.
  const r2 = await fetch(`${base}/lotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{esto no es json",
  });
  assert.equal(r2.status, 400);
  const cuerpo2 = (await r2.json()) as { motivo: string };
  assert.equal(typeof cuerpo2.motivo, "string");

  // Ficha inválida (tono desconocido): motivo, no tumbar.
  const r3 = await fetch(`${base}/lotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ficha: { ...FICHA, tono: "épico" }, lote: LOTE_CSV }),
  });
  assert.equal(r3.status, 400);
  const cuerpo3 = (await r3.json()) as { motivo: string };
  assert.match(cuerpo3.motivo, /tono/i);

  // El servicio sigue: una petición válida funciona después.
  const r4 = await fetch(`${base}/lotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ficha: FICHA, lote: LOTE_CSV }),
  });
  assert.equal(r4.status, 200);
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.14 — punto 3: el número máximo de reseñas por lote se configura
// ─────────────────────────────────────────────────────────────────────────────

test("RS.14: el límite de reseñas por lote se configura y se aplica", async () => {
  // El servidor de este archivo se creó con maxReseñasPorLote: 3 (ver
  // `before`). 5 líneas no caben.
  const loteGrande = `autor,estrellas,fecha,texto
A,5,2024-01-01,una
B,4,2024-01-02,dos
C,3,2024-01-03,tres
D,2,2024-01-04,cuatro
E,1,2024-01-05,cinco
`;

  const respuesta = await fetch(`${base}/lotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ficha: FICHA, lote: loteGrande }),
  });
  assert.equal(respuesta.status, 400);
  const cuerpo = (await respuesta.json()) as { motivo: string };
  assert.match(cuerpo.motivo, /m[áa]ximo/i);
  assert.match(cuerpo.motivo, /3/);

  // El constante pública existe y es un entero positivo.
  assert.equal(typeof MAX_RESEÑAS_POR_LOTE_DEFECTO, "number");
  assert.ok(Number.isInteger(MAX_RESEÑAS_POR_LOTE_DEFECTO));
  assert.ok(MAX_RESEÑAS_POR_LOTE_DEFECTO >= 1);
});

test("RS.14: el cliente puede pedir un tope más bajo y se respeta", async () => {
  // Con el servidor configurado a 3, el cliente pide 1: solo entra 1 reseña.
  const r1 = await fetch(`${base}/lotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ficha: FICHA, lote: LOTE_CSV, maxReseñas: 1 }),
  });
  assert.equal(r1.status, 400);
  const cuerpo1 = (await r1.json()) as { motivo: string };
  assert.match(cuerpo1.motivo, /1/);
});