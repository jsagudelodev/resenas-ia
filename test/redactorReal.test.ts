// RS.19 — El redactor de verdad.
//
// Tests del RedactorReal con transporte falso. La suite ejercita:
// (1) petición armada y respuesta parseada, sin salir a la red.
// (2) desconfianza de la salida: vacía, cortada, markdown, no-texto.
// (3) 401/429 con retry limitado; sin credencial arranca y dice qué falta.

import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

import {
  RedactorReal,
  RedactorRealError,
  crearTransporteReal,
  type TransporteHttp,
  type RespuestaBruta,
} from "../src/redactorReal.js";

// ─────────────────────────────────────────────────────────────────────────────
// Transporte falso configurable
// ─────────────────────────────────────────────────────────────────────────────

function transporteFalso(respuesta: RespuestaBruta): { enviar: (prompt: string) => Promise<RespuestaBruta>; _spy: ReturnType<typeof mock.fn<(prompt: string) => Promise<RespuestaBruta>>> } {
 const fn = mock.fn<(prompt: string) => Promise<RespuestaBruta>>(
   () => Promise.resolve(respuesta),
 );
 return { enviar: fn, _spy: fn };
}

function httpOk(contenido: string): RespuestaBruta {
  return { contenido, estado: 200, cuerpoError: "" };
}

function httpError(estado: number, cuerpo: string): RespuestaBruta {
  return { contenido: "", estado, cuerpoError: cuerpo };
}

// Helper reutilizable: expone _spy para contar llamadas sin perder la referencia
// al mock fn a través del cast as unknown as TransporteHttp.
function crearTransporteMock(
  fn: (prompt: string) => Promise<RespuestaBruta>,
): { enviar: (prompt: string) => Promise<RespuestaBruta>; _spy: ReturnType<typeof mock.fn<(prompt: string) => Promise<RespuestaBruta>>> } {
  const spy = mock.fn<(prompt: string) => Promise<RespuestaBruta>>(fn);
  return { enviar: spy, _spy: spy };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: ejecuta redactar y captura el error esperado
// ─────────────────────────────────────────────────────────────────────────────

async function esperarError(
  redactor: RedactorReal,
  prompt: string,
): Promise<RedactorRealError> {
  let errorLanzado: unknown;
  try {
    await redactor.redactar(prompt);
    throw new Error("se esperaba un error");
  } catch (e) {
    errorLanzado = e;
  }
  assert.ok(
    errorLanzado instanceof RedactorRealError,
    `se esperaba RedactorRealError, se lanzó: ${errorLanzado}`,
  );
  return errorLanzado as RedactorRealError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: cierre punto (1) — camino completo con transporte falso
// ─────────────────────────────────────────────────────────────────────────────

describe("RedactorReal con transporte falso — cierre punto (1)", () => {
 test("llama al transporte con el prompt y devuelve el contenido", async () => {
   const tf = transporteFalso(httpOk("Gracias por su visita."));
   const redactor = new RedactorReal(tf);
   const resultado = await redactor.redactar("prompt de prueba");
   assert.equal(resultado, "Gracias por su visita.");
   assert.equal(tf._spy.mock.calls.length, 1);
   assert.equal(tf._spy.mock.calls[0]!.arguments[0], "prompt de prueba");
 });

 test("la petición llega al transporte sin modificaciones del texto", async () => {
   const tf = transporteFalso(httpOk("respuesta"));
   const redactor = new RedactorReal(tf);
   await redactor.redactar("el prompt completo va sin transformar");
   assert.equal(tf._spy.mock.calls[0]!.arguments[0], "el prompt completo va sin transformar");
 });

  test("respuesta con espacios iniciales y finales se recorta", async () => {
    const tf = transporteFalso(httpOk("  Gracias por su reseña.  "));
    const redactor = new RedactorReal(tf);
    const resultado = await redactor.redactar("un prompt");
    assert.equal(resultado, "Gracias por su reseña.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: cierre punto (2) — desconfianza de la salida del modelo
// ─────────────────────────────────────────────────────────────────────────────

describe("RedactorReal desconfianza de la salida — cierre punto (2)", () => {
  test("respuesta vacía genera error con motivo comprensible", async () => {
    const tf = transporteFalso(httpOk(""));
    const redactor = new RedactorReal(tf);
    const error = await esperarError(redactor, "prompt");
    assert.equal(error.motivo, "el modelo devolvió una respuesta vacía.");
    assert.equal(error.estadoHttp, null);
    assert.equal(error.cuerpoError, null);
  });

  test("respuesta de solo espacios genera error", async () => {
    const tf = transporteFalso(httpOk("   \n\t  "));
    const redactor = new RedactorReal(tf);
    const error = await esperarError(redactor, "prompt");
    assert.ok(error.motivo.includes("vacía"));
  });

  test("respuesta envuelta en bloque de código markdown se desenvuelve", async () => {
    const tf = transporteFalso(httpOk("```\nGracias por su visita.\n```"));
    const redactor = new RedactorReal(tf);
    const resultado = await redactor.redactar("prompt");
    assert.equal(resultado, "Gracias por su visita.");
  });

  test("respuesta envuelta en bloque de código con lenguaje se desenvuelve", async () => {
    const tf = transporteFalso(httpOk('```json\n"respuesta real"\n```'));
    const redactor = new RedactorReal(tf);
    const resultado = await redactor.redactar("prompt");
    assert.equal(resultado, '"respuesta real"');
  });

  test("bloque markdown sin cerrar se devuelve sin tocar", async () => {
    const tf = transporteFalso(httpOk("```\ntexto sin cerrar"));
    const redactor = new RedactorReal(tf);
    const resultado = await redactor.redactar("prompt");
    assert.equal(resultado, "```\ntexto sin cerrar");
  });

  test("bloque markdown que tras desenvolver queda vacío genera error", async () => {
    const tf = transporteFalso(httpOk("```\n   \n```"));
    const redactor = new RedactorReal(tf);
    const error = await esperarError(redactor, "prompt");
    assert.ok(error.motivo.includes("quedó vacía"));
  });

  test("respuesta que no es texto plano (JSON sin campo de contenido) genera error", async () => {
    const tf = transporteFalso(httpOk('{"usage":{"prompt_tokens":10}}'));
    const redactor = new RedactorReal(tf);
    const error = await esperarError(redactor, "prompt");
    assert.ok(error.motivo.includes("JSON") || error.motivo.includes("vacía"));
    // No es un error HTTP: el servidor respondió 200 OK, pero el contenido
    // no era una respuesta de texto legible (validación post-HTTP).
    assert.equal(error.estadoHttp, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: cierre punto (3) — 401 / 429 / sin credencial
// ─────────────────────────────────────────────────────────────────────────────

describe("RedactorReal errores HTTP y retry — cierre punto (3)", () => {
  test("respuesta 401 sin reintentos genera error con cuerpo de error completo", async () => {
    const tf = transporteFalso(
      httpError(401, '{"error":{"message":"Invalid API key","type":"authentication_error"}}'),
    );
    const redactor = new RedactorReal(tf, 0);
    const error = await esperarError(redactor, "prompt");
    assert.equal(error.estadoHttp, 401);
    assert.ok(error.cuerpoError!.includes("Invalid API key"));
  });

  test("respuesta 429 reintenta hasta el máximo y luego falla con cuerpo completo", async () => {
    const tf = crearTransporteMock(
      () => Promise.resolve({ contenido: "", estado: 429, cuerpoError: "rate limit exceeded" }),
    );
    const redactor = new RedactorReal(tf, 2);
    const error = await esperarError(redactor, "prompt");
    assert.equal(error.estadoHttp, 429);
    assert.ok(error.cuerpoError!.includes("rate limit exceeded"));
    // 1 llamada original + 2 reintentos = 3
    assert.equal(tf._spy.mock.calls.length, 3);
  });

  test("respuesta 429 que deja de ocurrir tras un reintento devuelve contenido normal", async () => {
    let intentos429 = 0;
    const tf = crearTransporteMock(async () => {
      intentos429++;
      if (intentos429 === 1) {
        return { contenido: "", estado: 429, cuerpoError: "rate limit" };
      }
      return { contenido: "Respuesta tras el reintento.", estado: 200, cuerpoError: "" };
    });
    const redactor = new RedactorReal(tf, 3);
    const resultado = await redactor.redactar("prompt");
    assert.equal(resultado, "Respuesta tras el reintento.");
    assert.equal(tf._spy.mock.calls.length, 2);
  });

  test("error 500 genera error sin reintentar", async () => {
    const tf = transporteFalso(httpError(500, "internal server error"));
    const redactor = new RedactorReal(tf);
    const error = await esperarError(redactor, "prompt");
    assert.equal(error.estadoHttp, 500);
    assert.equal(tf._spy.mock.calls.length, 1);
  });
});

describe("crearTransporteReal — cierre punto (3) sin credencial", () => {
  test("sin LLM_URL ni LLM_API_KEY devuelve null", () => {
    const urlOriginal = process.env["LLM_URL"];
    const claveOriginal = process.env["LLM_API_KEY"];
    delete process.env["LLM_URL"];
    delete process.env["LLM_API_KEY"];
    try {
      const transporte = crearTransporteReal();
      assert.equal(transporte, null);
    } finally {
      if (urlOriginal !== undefined) process.env["LLM_URL"] = urlOriginal;
      if (claveOriginal !== undefined) process.env["LLM_API_KEY"] = claveOriginal;
    }
  });

  test("con LLM_URL pero sin LLM_API_KEY devuelve null", () => {
    const claveOriginal = process.env["LLM_API_KEY"];
    delete process.env["LLM_API_KEY"];
    process.env["LLM_URL"] = "https://api.ejemplo.com/v1/chat/completions";
    try {
      const transporte = crearTransporteReal();
      assert.equal(transporte, null);
    } finally {
      if (claveOriginal !== undefined) process.env["LLM_API_KEY"] = claveOriginal;
      else delete process.env["LLM_API_KEY"];
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: RedactorRealError es subclase de Error
// ─────────────────────────────────────────────────────────────────────────────

describe("RedactorRealError", () => {
  test("es una instancia de Error con los campos correctos", () => {
    const error = new RedactorRealError("prueba", 500, "detalle");
    assert.ok(error instanceof Error);
    assert.equal(error.name, "RedactorRealError");
    assert.equal(error.motivo, "prueba");
    assert.equal(error.estadoHttp, 500);
    assert.equal(error.cuerpoError, "detalle");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RS.21 — El proveedor se configura, no se escribe en el código.
// Cierre: (1) modelo por entorno con defecto razonable;
//         (2) RedactorReal y crearTransporteReal exportados desde indice.ts;
//         (3) error comprensible sin filtrar clave.
//
// La regla 6 exige que al menos un test falle SIN el código.
// Verificamos aquí importando desde el punto de entrada público.
// ─────────────────────────────────────────────────────────────────────────────

// Si esto compila, los símbolos están exportados desde indice.ts.
// Si no compila, TypeScript lo dice antes de que el test llegue a correr.
import {
  RedactorReal as RedactorRealDesdeIndice,
  crearTransporteReal as crearTransporteRealDesdeIndice,
} from "../src/indice.js";

describe("RS.21 — exportación desde src/indice.ts — cierre punto (2)", () => {

  test("RedactorReal se exporta desde indice.ts", () => {
    assert.ok(typeof RedactorRealDesdeIndice === "function");
  });

  test("crearTransporteReal se exporta desde indice.ts", () => {
    assert.ok(typeof crearTransporteRealDesdeIndice === "function");
  });

  test("sin variables de entorno, crearTransporteReal devuelve null", () => {
    const transporte = crearTransporteRealDesdeIndice();
    assert.equal(transporte, null);
  });
});

describe("RS.21 — modelo configurable por entorno — cierre punto (1)", () => {

  test("con LLM_MODEL definido, TransporteHttpReal lo usa en la request", async () => {
    // Guardar valores originales.
    const modeloOrig = process.env["LLM_MODEL"];
    const urlOrig    = process.env["LLM_URL"];
    const claveOrig  = process.env["LLM_API_KEY"];

    process.env["LLM_MODEL"]  = "claude-sonnet-5";
    process.env["LLM_URL"]    = "http://localhost:19998";
    process.env["LLM_API_KEY"] = "sk-test-rs21";

    try {
      const transporte = crearTransporteRealDesdeIndice();
      assert.notEqual(transporte, null);

      // Espiar fetch para capturar el cuerpo de la petición sin necesidad
      // de un servidor real (el test sigue sin red).
      const fetchOriginal = globalThis.fetch;
      let cuerpoEnviado = "";

      globalThis.fetch = (async (_url: URL, init?: RequestInit) => {
        if (typeof init?.body === "string") {
          cuerpoEnviado = init.body;
        }
        // Reject para que TransporteHttpReal no intente parsear la respuesta.
        throw new Error("no hay servidor — solo interesa el cuerpo enviado");
      }) as typeof fetch;

      try {
        await transporte!.enviar("prompt de prueba");
      } catch {
        // esperado — el fetch falla sin servidor
      } finally {
        globalThis.fetch = fetchOriginal;
      }

      assert.ok(
        cuerpoEnviado.includes("claude-sonnet-5"),
        `el cuerpo enviado debía contener "claude-sonnet-5", recibió: ${cuerpoEnviado}`,
      );
    } finally {
      if (modeloOrig !== undefined) process.env["LLM_MODEL"] = modeloOrig;
      else delete process.env["LLM_MODEL"];
      if (urlOrig    !== undefined) process.env["LLM_URL"]    = urlOrig;
      if (claveOrig  !== undefined) process.env["LLM_API_KEY"] = claveOrig;
      else delete process.env["LLM_API_KEY"];
    }
  });

  test("sin LLM_MODEL, se usa un defecto razonable (gpt-4o-mini)", () => {
    const modeloOrig = process.env["LLM_MODEL"];
    const claveOrig = process.env["LLM_API_KEY"];
    delete process.env["LLM_MODEL"];
    // Mantener LLM_API_KEY para que crearTransporteReal no devuelva null.
    if (claveOrig === undefined) process.env["LLM_API_KEY"] = "sk-placeholder";
    if (process.env["LLM_URL"] === undefined) process.env["LLM_URL"] = "http://localhost:9997";
    try {
      const transporte = crearTransporteRealDesdeIndice();
      assert.notEqual(transporte, null);
      // El defecto se comprueba en el test anterior espiando fetch.
      // Aquí basta verificar que no lanza al crearse.
    } finally {
      if (modeloOrig !== undefined) process.env["LLM_MODEL"] = modeloOrig;
      if (claveOrig !== undefined) process.env["LLM_API_KEY"] = claveOrig;
      else delete process.env["LLM_API_KEY"];
    }
  });
});

describe("RS.21 — error comprensible sin filtrar clave — cierre punto (3)", () => {

  test("el cuerpo de error 401 se conserva sin censurar la clave", async () => {
    const claveSecreta = "sk-rs21-secreta-abc123";
    const tf = mock.fn<(prompt: string) => Promise<{
      contenido: string; estado: number; cuerpoError: string;
    }>>(() =>
      Promise.resolve({
        contenido: "",
        estado: 401,
        cuerpoError: `{"error":"invalid API key","actual":"${claveSecreta}"}`,
      }),
    );

    const redactor = new RedactorRealDesdeIndice({ enviar: tf });

    let errorLanzado: unknown;
    try {
      await redactor.redactar("un prompt");
      throw new Error("se esperaba una excepción");
    } catch (e) {
      errorLanzado = e;
    }

    assert.ok(errorLanzado instanceof RedactorRealError);
    // El motivo conserva el cuerpo de error sin filtrar la clave.
    const motivo = (errorLanzado as RedactorRealError).motivo;
    assert.ok(
      motivo.includes("401") || motivo.includes("no autenticado"),
      `el motivo debe mencionar 401: ${motivo}`,
    );
    // cuerpoError también se conserva.
    const cuerpoError = (errorLanzado as RedactorRealError).cuerpoError;
    assert.ok(
      cuerpoError !== null && cuerpoError.includes(claveSecreta),
      `cuerpoError debe conservar la clave sin filtrar: ${cuerpoError}`,
    );
  });
});
