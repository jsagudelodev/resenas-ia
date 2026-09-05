// RS.10 — Que dos veces la misma reseña dé la misma respuesta.
//
// Cierre: (1) el mismo lote procesado dos veces llama al LLM la segunda vez
// cero veces y devuelve las mismas respuestas; (2) cambiar la ficha del
// negocio SÍ invalida lo guardado —el tono cambió—; (3) lo guardado sobrevive
// a reiniciar el proceso.
//
// Los tres puntos se comprueban sobre `procesarLote` (RS.8) con un redactor
// contador, sin red ni credenciales: el modelo es un falso que firma la
// respuesta con el autor de la reseña.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { procesarLote } from "../src/procesarLote.js";
import {
  AlmacenRespuestasEnMemoria,
  AlmacenRespuestasSqlite,
  claveDePrompt,
  RedactorConMemoria,
} from "../src/almacenRespuestas.js";
import type { Redactor } from "../src/redactor.js";
import type { FichaNegocio } from "../src/fichaNegocio.js";
import type { ReseñaNegocio } from "../src/convertirReseñas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Datos y redactor contador
// ─────────────────────────────────────────────────────────────────────────────

const fichaCercana: FichaNegocio = {
  nombre: "La Esquina",
  actividad: "restaurante",
  tono: "cercano",
  contacto: { telefono: "555-0100" },
  ofrece: { gestos: ["repetir el plato"] },
  noOfrece: { gestos: ["devoluciones en efectivo"] },
  idiomaPorDefecto: "es",
};

/** La misma ficha, pero con el tono cambiado (punto 2 del cierre). */
const fichaFormal: FichaNegocio = {
  ...fichaCercana,
  tono: "formal",
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

/** Redactor falso que además cuenta cuántas veces lo llamaron. */
class RedactorContador implements Redactor {
  llamadas: number = 0;
  /** Prompts que llegaron al modelo, para depurar una clave inesperada. */
  readonly prompts: string[] = [];

  async redactar(prompt: string): Promise<string> {
    this.llamadas += 1;
    this.prompts.push(prompt);
    const autor = prompt.match(/Reseña de ([^:]+):/)?.[1] ?? "anónimo";
    const tono = prompt.match(/Tono: (\w+)/)?.[1] ?? "sin-tono";
    return `Respuesta de La Esquina a ${autor} (tono ${tono}).`;
  }
}

function loteDePrueba(cantidad: number): ReseñaNegocio[] {
  const reseñas: ReseñaNegocio[] = [];
  for (let i = 0; i < cantidad; i++) {
    reseñas.push(reseña(`Cliente ${i}`, `Reseña número ${i}`, (i % 5) + 1));
  }
  return reseñas;
}

/** Textos de las respuestas listas, en orden, para comparar pasadas. */
function textosListos(lote: Awaited<ReturnType<typeof procesarLote>>): string[] {
  const textos: string[] = [];
  for (const resultado of lote.resultados) {
    if ("texto" in resultado) {
      textos.push(resultado.texto);
    }
  }
  return textos;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cierre — punto 1: la segunda vez, cero llamadas al LLM y mismas respuestas
// ─────────────────────────────────────────────────────────────────────────────

test("RS.10 punto 1: el mismo lote procesado dos veces llama al LLM cero veces la segunda", async () => {
  const reseñas = loteDePrueba(30);
  const redactor = new RedactorContador();
  const conMemoria = new RedactorConMemoria(redactor, new AlmacenRespuestasEnMemoria());

  const primera = await procesarLote(reseñas, fichaCercana, conMemoria);
  const llamadasTrasPrimera = redactor.llamadas;
  const segunda = await procesarLote(reseñas, fichaCercana, conMemoria);

  assert.equal(
    llamadasTrasPrimera,
    30,
    "la primera pasada no tiene nada guardado: llama al modelo por reseña",
  );
  assert.equal(
    redactor.llamadas,
    llamadasTrasPrimera,
    "la segunda pasada no debe haber llamado al modelo ni una vez",
  );
  assert.equal(primera.listas, 30);
  assert.equal(segunda.listas, 30);
  assert.deepEqual(textosListos(segunda), textosListos(primera));
});

test("RS.10 punto 1: reenviar el lote con dos reseñas nuevas solo paga esas dos", async () => {
  const originales = loteDePrueba(28);
  const redactor = new RedactorContador();
  const almacen = new AlmacenRespuestasEnMemoria();
  const conMemoria = new RedactorConMemoria(redactor, almacen);

  await procesarLote(originales, fichaCercana, conMemoria);
  assert.equal(redactor.llamadas, 28);

  // El dueño reenvía el lote con dos reseñas nuevas al final.
  const reenviado = [
    ...originales,
    reseña("Cliente 28", "Reseña número 28", 4),
    reseña("Cliente 29", "Reseña número 29", 2),
  ];
  const segunda = await procesarLote(reenviado, fichaCercana, conMemoria);

  assert.equal(
    redactor.llamadas,
    30,
    "solo las dos reseñas nuevas se redactan; las 28 de antes no se vuelven a pagar",
  );
  assert.equal(segunda.resultados.length, 30);
  assert.equal(almacen.tamano, 30);
});

test("RS.10 punto 1: una reseña repetida dentro del mismo lote se redacta una sola vez", async () => {
  const redactor = new RedactorContador();
  const conMemoria = new RedactorConMemoria(redactor, new AlmacenRespuestasEnMemoria());
  const duplicada = reseña("Cliente 1", "Comida excelente", 5);

  const lote = await procesarLote([duplicada, duplicada], fichaCercana, conMemoria);

  assert.equal(redactor.llamadas, 1, "la segunda copia sale del almacén");
  assert.equal(lote.listas, 2, "las dos entradas devuelven respuesta");
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre — punto 2: cambiar la ficha SÍ invalida lo guardado
// ─────────────────────────────────────────────────────────────────────────────

test("RS.10 punto 2: cambiar el tono de la ficha invalida lo guardado y reescribe la respuesta", async () => {
  const reseñas = loteDePrueba(3);
  const redactor = new RedactorContador();
  const almacen = new AlmacenRespuestasEnMemoria();
  const conMemoria = new RedactorConMemoria(redactor, almacen);

  const conTonoCercano = await procesarLote(reseñas, fichaCercana, conMemoria);
  assert.equal(redactor.llamadas, 3);

  // Misma ficha otra vez: nada nuevo que pagar.
  await procesarLote(reseñas, fichaCercana, conMemoria);
  assert.equal(redactor.llamadas, 3);

  // El negocio pasa de cercano a formal: lo guardado ya no sirve.
  const conTonoFormal = await procesarLote(reseñas, fichaFormal, conMemoria);
  assert.equal(
    redactor.llamadas,
    6,
    "el tono cambió, así que las 3 reseñas vuelven a pasar por el modelo",
  );

  const textosCercanos = textosListos(conTonoCercano);
  const textosFormales = textosListos(conTonoFormal);
  assert.notDeepEqual(textosFormales, textosCercanos);
  for (const texto of textosFormales) {
    assert.match(texto, /tono formal/, "la respuesta nueva refleja el tono de la ficha");
  }
  // Las dos versiones conviven: cambiar de tono no borra lo anterior.
  assert.equal(almacen.tamano, 6);
});

test("RS.10 punto 2: cambiar el nombre del negocio también invalida lo guardado", async () => {
  const reseñas = loteDePrueba(2);
  const redactor = new RedactorContador();
  const conMemoria = new RedactorConMemoria(redactor, new AlmacenRespuestasEnMemoria());

  await procesarLote(reseñas, fichaCercana, conMemoria);
  assert.equal(redactor.llamadas, 2);

  await procesarLote(reseñas, { ...fichaCercana, nombre: "La Esquina Bistrot" }, conMemoria);
  assert.equal(redactor.llamadas, 4, "otra ficha, otras claves, otra redacción");
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre — punto 3: lo guardado sobrevive a reiniciar el proceso
// ─────────────────────────────────────────────────────────────────────────────

test("RS.10 punto 3: lo guardado en SQLite sobrevive a cerrar el almacén y abrirlo otra vez", async () => {
  const directorio = mkdtempSync(join(tmpdir(), "resenas-cache-rs10-"));
  const ruta = join(directorio, "respuestas.sqlite");
  const reseñas = loteDePrueba(3);

  try {
    const redactorAntes = new RedactorContador();
    const almacenAntes = new AlmacenRespuestasSqlite(ruta);
    const primera = await procesarLote(
      reseñas,
      fichaCercana,
      new RedactorConMemoria(redactorAntes, almacenAntes),
    );
    assert.equal(redactorAntes.llamadas, 3);
    almacenAntes.cerrar();

    // "Reiniciar el proceso": almacén nuevo, redactor nuevo, mismo archivo.
    const redactorDespues = new RedactorContador();
    const almacenDespues = new AlmacenRespuestasSqlite(ruta);
    const segunda = await procesarLote(
      reseñas,
      fichaCercana,
      new RedactorConMemoria(redactorDespues, almacenDespues),
    );

    assert.equal(
      redactorDespues.llamadas,
      0,
      "tras reiniciar, la caché en disco sigue teniendo las respuestas",
    );
    assert.deepEqual(textosListos(segunda), textosListos(primera));
    almacenDespues.cerrar();
  } finally {
    rmSync(directorio, { recursive: true, force: true });
  }
});

test("RS.10 punto 3: el almacén en SQLite lee y escribe la misma clave que guarda", async () => {
  const almacen = new AlmacenRespuestasSqlite(":memory:");
  const clave = claveDePrompt("prompt de prueba");

  assert.equal(await almacen.buscar(clave), null, "sin datos, devuelve null");
  await almacen.guardar(clave, "respuesta guardada");
  assert.equal(await almacen.buscar(clave), "respuesta guardada");

  // Reemplazo, no duplicado.
  await almacen.guardar(clave, "respuesta corregida");
  assert.equal(await almacen.buscar(clave), "respuesta corregida");
  almacen.cerrar();
});

// ─────────────────────────────────────────────────────────────────────────────
// Lo que NO se guarda: los fallos del redactor
// ─────────────────────────────────────────────────────────────────────────────

test("RS.10: un fallo del redactor no se guarda; la siguiente pasada reintenta", async () => {
  let veces = 0;
  const redactorFalible: Redactor = {
    async redactar(): Promise<string> {
      veces += 1;
      if (veces === 1) {
        throw new Error("el modelo no está disponible");
      }
      return "Respuesta de La Esquina tras recuperar el servicio.";
    },
  };
  const almacen = new AlmacenRespuestasEnMemoria();
  const conMemoria = new RedactorConMemoria(redactorFalible, almacen);
  const reseñas = [reseña("Cliente 1", "Regular", 2)];

  const primera = await procesarLote(reseñas, fichaCercana, conMemoria);
  assert.equal(primera.fallaron, 1);
  assert.equal(almacen.tamano, 0, "el fallo no ocupa un hueco en la caché");

  const segunda = await procesarLote(reseñas, fichaCercana, conMemoria);
  assert.equal(veces, 2, "la reseña vuelve a pasar por el modelo");
  assert.equal(segunda.listas, 1);
  assert.equal(almacen.tamano, 1);
});

test("RS.10: la clave del prompt es determinista y sensible a cada carácter", () => {
  assert.equal(claveDePrompt("a"), claveDePrompt("a"));
  assert.notEqual(claveDePrompt("a"), claveDePrompt("b"));
  assert.match(claveDePrompt("a"), /^[0-9a-f]{64}$/);
});