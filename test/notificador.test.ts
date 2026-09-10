// RS.28 — Avisar cuando el paquete está listo.
//
// Cierre: (1) un aviso llega al webhook configurado con los datos del
// paquete (enlace, conteos, nombre del negocio); (2) sin `NOTIFICADOR_URL`,
// `crearNotificadorWebhook` devuelve `null` — el sistema arranca igual y
// sin avisos; (3) un estado no-2xx se convierte en `NotificadorError` con
// motivo comprensible, sin filtrar la clave de autorización.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  NotificadorWebhook,
  NotificadorError,
  crearNotificadorWebhook,
  type AvisoPaquete,
} from "../src/notificador.js";

const AVISO: AvisoPaquete = {
  placeId: "place-1",
  nombreNegocio: "La Esquina",
  paqueteId: "paquete-123",
  conteos: { listas: 8, paraRevision: 2, fallaron: 0 },
  enlaceUrl: "http://127.0.0.1:0/enlace/abc123",
};

describe("NotificadorWebhook — cierre punto (1)", () => {
  test("hace POST con el aviso completo como JSON", async () => {
    const fetchOriginal = globalThis.fetch;
    let urlLlamada = "";
    let metodoLlamado = "";
    let cuerpoEnviado = "";
    let headersEnviados: Headers | undefined;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      urlLlamada = String(url);
      metodoLlamado = init?.method ?? "";
      cuerpoEnviado = typeof init?.body === "string" ? init.body : "";
      headersEnviados = new Headers(init?.headers);
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      const notificador = new NotificadorWebhook("https://aviso.ejemplo.com/hook", "clave-secreta");
      await notificador.avisar(AVISO);

      assert.equal(urlLlamada, "https://aviso.ejemplo.com/hook");
      assert.equal(metodoLlamado, "POST");
      assert.equal(headersEnviados?.get("Authorization"), "Bearer clave-secreta");
      const cuerpo = JSON.parse(cuerpoEnviado) as AvisoPaquete;
      assert.deepEqual(cuerpo, AVISO);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });

  test("sin clave, no manda cabecera Authorization", async () => {
    const fetchOriginal = globalThis.fetch;
    let headersEnviados: Headers | undefined;
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      headersEnviados = new Headers(init?.headers);
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      const notificador = new NotificadorWebhook("https://aviso.ejemplo.com/hook");
      await notificador.avisar(AVISO);
      assert.equal(headersEnviados?.has("Authorization"), false);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });
});

describe("crearNotificadorWebhook — cierre punto (2)", () => {
  test("sin NOTIFICADOR_URL devuelve null", () => {
    const original = process.env["NOTIFICADOR_URL"];
    delete process.env["NOTIFICADOR_URL"];
    try {
      assert.equal(crearNotificadorWebhook(), null);
    } finally {
      if (original !== undefined) process.env["NOTIFICADOR_URL"] = original;
    }
  });

  test("con NOTIFICADOR_URL configurada, devuelve un notificador", () => {
    const original = process.env["NOTIFICADOR_URL"];
    process.env["NOTIFICADOR_URL"] = "https://aviso.ejemplo.com/hook";
    try {
      const notificador = crearNotificadorWebhook();
      assert.notEqual(notificador, null);
      assert.ok(notificador instanceof NotificadorWebhook);
    } finally {
      if (original !== undefined) process.env["NOTIFICADOR_URL"] = original;
      else delete process.env["NOTIFICADOR_URL"];
    }
  });
});

describe("NotificadorWebhook — cierre punto (3): error sin filtrar la clave", () => {
  test("un estado no-2xx lanza NotificadorError con el cuerpo, sin la clave en el mensaje", async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("cuota agotada", { status: 429 })) as typeof fetch;

    try {
      const claveSecreta = "clave-super-secreta-123";
      const notificador = new NotificadorWebhook("https://aviso.ejemplo.com/hook", claveSecreta);
      await assert.rejects(
        () => notificador.avisar(AVISO),
        (error: unknown) => {
          assert.ok(error instanceof NotificadorError);
          assert.ok(error.message.includes("429"));
          assert.ok(error.message.includes("cuota agotada"));
          assert.ok(!error.message.includes(claveSecreta));
          return true;
        },
      );
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });
});

// Importado desde el punto de entrada público: si esto no compila, las
// piezas no están exportadas desde indice.ts.
import { NotificadorWebhook as NotificadorDesdeIndice } from "../src/indice.js";

describe("Notificador — exportado desde indice.ts", () => {
  test("NotificadorWebhook se exporta", () => {
    assert.equal(typeof NotificadorDesdeIndice, "function");
  });
});
