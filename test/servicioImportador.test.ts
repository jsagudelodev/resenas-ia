// RS.25 — El endpoint que conecta un negocio con su paquete (POST /lotes/importar).
//
// Cierre: (1) sin reseñas nuevas responde 200 sin crear paquete; (2) sin
// importador configurado responde 501 y el servidor sigue funcionando para
// POST /lotes; (3) un fallo del proveedor (ImportadorError) responde 502 con
// motivo comprensible y el servicio no cae.
//
// Todo corre contra el servidor real en 127.0.0.1 (puerto efímero) con
// `fetch` de Node 22: loopback, no internet, sin credenciales.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  crearServidor,
  AlmacenDeLotesEnMemoria,
  type ServidorLevantado,
  type SalidaImportarLote,
} from "../src/servicio.js";
import {
  ImportadorReseñas,
  AlmacenImportacionEnMemoria,
  type ReseñaImportada,
  type TransporteImportacion,
} from "../src/importadorReseñas.js";

const FICHA = {
  nombre: "La Esquina",
  actividad: "restaurante",
  tono: "cercano" as const,
  contacto: { telefono: "555-0100" },
  ofrece: { gestos: ["repetir el plato"] },
  noOfrece: { gestos: ["devoluciones en efectivo"] },
  idiomaPorDefecto: "es" as const,
};

function transporteFalso(reseñas: ReseñaImportada[]): TransporteImportacion {
  return { obtenerReseñas: () => Promise.resolve(reseñas) };
}

const RESEÑA_BUENA: ReseñaImportada = {
  idExterno: "r1",
  autor: "Marcela",
  texto: "La bandeja paisa estaba increíble.",
  estrellas: 5,
  fecha: "2026-09-01",
};

// ─────────────────────────────────────────────────────────────────────────────
// Cierre punto (2) — sin importador configurado
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /lotes/importar sin importador configurado — cierre punto (2)", () => {
  let servidor: ServidorLevantado;
  let base: string;

  before(async () => {
    servidor = await crearServidor({}, new AlmacenDeLotesEnMemoria());
    base = servidor.url;
  });
  after(async () => {
    await servidor.cerrar();
  });

  test("responde 501 con motivo", async () => {
    const respuesta = await fetch(`${base}/lotes/importar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId: "place-1", ficha: FICHA }),
    });
    assert.equal(respuesta.status, 501);
    const cuerpo = (await respuesta.json()) as { motivo: string };
    assert.ok(cuerpo.motivo.includes("no está configurada"));
  });

  test("POST /lotes sigue funcionando en el mismo servidor", async () => {
    const respuesta = await fetch(`${base}/lotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ficha: FICHA,
        lote: "autor,estrellas,fecha,texto\nAna,5,2024-03-01,Muy bueno todo.\n",
      }),
    });
    assert.equal(respuesta.status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre punto (1) — sin reseñas nuevas
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /lotes/importar sin reseñas nuevas — cierre punto (1)", () => {
  let servidor: ServidorLevantado;
  let base: string;

  before(async () => {
    const almacenImportacion = new AlmacenImportacionEnMemoria();
    const importador = new ImportadorReseñas(transporteFalso([]), almacenImportacion);
    servidor = await crearServidor({ importador }, new AlmacenDeLotesEnMemoria());
    base = servidor.url;
  });
  after(async () => {
    await servidor.cerrar();
  });

  test("responde 200 sin crear paquete (id: null)", async () => {
    const respuesta = await fetch(`${base}/lotes/importar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId: "place-1", ficha: FICHA }),
    });
    assert.equal(respuesta.status, 200);
    const cuerpo = (await respuesta.json()) as SalidaImportarLote;
    assert.equal(cuerpo.id, null);
    assert.equal(cuerpo.nuevas, 0);
    assert.equal(cuerpo.conteos.listas, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Camino feliz: reseñas nuevas se procesan y arman paquete descargable
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /lotes/importar con reseñas nuevas", () => {
  let servidor: ServidorLevantado;
  let base: string;
  const almacenImportacion = new AlmacenImportacionEnMemoria();

  before(async () => {
    const importador = new ImportadorReseñas(
      transporteFalso([RESEÑA_BUENA]),
      almacenImportacion,
    );
    servidor = await crearServidor({ importador }, new AlmacenDeLotesEnMemoria());
    base = servidor.url;
  });
  after(async () => {
    await servidor.cerrar();
  });

  test("procesa la reseña nueva, devuelve id y el paquete se descarga", async () => {
    const respuesta = await fetch(`${base}/lotes/importar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId: "place-1", ficha: FICHA }),
    });
    assert.equal(respuesta.status, 200);
    const cuerpo = (await respuesta.json()) as SalidaImportarLote;
    assert.notEqual(cuerpo.id, null);
    assert.equal(cuerpo.nuevas, 1);
    assert.equal(cuerpo.conteos.listas, 1);

    const descarga = await fetch(`${base}/lotes/${cuerpo.id}/paquete`);
    assert.equal(descarga.status, 200);
    const csv = await descarga.text();
    assert.ok(csv.includes("Marcela"));
  });

  test("una segunda llamada sobre el mismo negocio no reimporta (dedup)", async () => {
    const respuesta = await fetch(`${base}/lotes/importar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId: "place-1", ficha: FICHA }),
    });
    const cuerpo = (await respuesta.json()) as SalidaImportarLote;
    assert.equal(cuerpo.id, null);
    assert.equal(cuerpo.nuevas, 0);
    assert.equal(cuerpo.yaVistas, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre punto (3) — fallo del proveedor no tumba el servicio
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /lotes/importar con proveedor caído — cierre punto (3)", () => {
  let servidor: ServidorLevantado;
  let base: string;

  before(async () => {
    const transporteCaido: TransporteImportacion = {
      obtenerReseñas: () => Promise.reject(new Error("timeout del proveedor")),
    };
    const importador = new ImportadorReseñas(
      transporteCaido,
      new AlmacenImportacionEnMemoria(),
    );
    servidor = await crearServidor({ importador }, new AlmacenDeLotesEnMemoria());
    base = servidor.url;
  });
  after(async () => {
    await servidor.cerrar();
  });

  test("responde 502 con motivo y el servicio sigue escuchando", async () => {
    const respuesta = await fetch(`${base}/lotes/importar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId: "place-1", ficha: FICHA }),
    });
    assert.equal(respuesta.status, 502);
    const cuerpo = (await respuesta.json()) as { motivo: string };
    assert.ok(cuerpo.motivo.includes("timeout del proveedor"));

    // El servicio sigue vivo: /salud responde normal después del fallo.
    const salud = await fetch(`${base}/salud`);
    assert.equal(salud.status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validación de entrada
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /lotes/importar validación de entrada", () => {
  let servidor: ServidorLevantado;
  let base: string;

  before(async () => {
    const importador = new ImportadorReseñas(
      transporteFalso([RESEÑA_BUENA]),
      new AlmacenImportacionEnMemoria(),
    );
    servidor = await crearServidor({ importador }, new AlmacenDeLotesEnMemoria());
    base = servidor.url;
  });
  after(async () => {
    await servidor.cerrar();
  });

  test("sin placeId responde 400 con motivo", async () => {
    const respuesta = await fetch(`${base}/lotes/importar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ficha: FICHA }),
    });
    assert.equal(respuesta.status, 400);
    const cuerpo = (await respuesta.json()) as { motivo: string };
    assert.ok(cuerpo.motivo.includes("placeId"));
  });

  test("ficha inválida responde 400 con motivo", async () => {
    const respuesta = await fetch(`${base}/lotes/importar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId: "place-1", ficha: { tono: "épico" } }),
    });
    assert.equal(respuesta.status, 400);
    const cuerpo = (await respuesta.json()) as { motivo: string };
    assert.ok(cuerpo.motivo.includes("tono"));
  });
});
