// RS.15 — Lo que ya se publicó no se vuelve a entregar.
//
// Cierre:
//   (1) una respuesta se puede marcar como publicada, y el paquete siguiente
//       la trae separada de las nuevas, no mezclada ni borrada.
//   (2) marcar dos veces la misma respuesta NO la duplica ni cambia la fecha
//       de la primera.
//   (3) lo marcado sobrevive a reiniciar el proceso, y los paquetes guardados
//       antes de este ítem se siguen leyendo igual que antes.
//
// Los tests prueban el comportamiento sin red ni credenciales.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { procesarLote } from "../src/procesarLote.js";
import {
  AlmacenRespuestasSqlite,
  AlmacenRespuestasEnMemoria,
  RedactorConMemoria,
  MarcarRespuestasPublicadas,
  claveDePrompt,
} from "../src/almacenRespuestas.js";
import type { Redactor } from "../src/redactor.js";
import type { FichaNegocio } from "../src/fichaNegocio.js";
import type { ReseñaNegocio } from "../src/convertirReseñas.js";
import { separarPublicadasYNuevas } from "../src/empaquetar.js";
import type { FilaPaquete } from "../src/empaquetar.js";

// ─────────────────────────────────────────────────────────────────────────────
// Datos y helpers
// ─────────────────────────────────────────────────────────────────────────────

const ficha: FichaNegocio = {
  nombre: "La Esquina",
  actividad: "restaurante",
  tono: "cercano",
  contacto: { telefono: "555-0100" },
  ofrece: { gestos: ["repetir el plato"] },
  noOfrece: { gestos: ["devoluciones en efectivo"] },
  idiomaPorDefecto: "es",
};

function reseña(autor: string, estrellas: number): ReseñaNegocio {
  return {
    autor,
    texto: `Reseña de ${autor}`,
    estrellas,
    fecha: "2024-03-01",
    incompleta: false,
    motivo: null,
  };
}

class RedactorFalsoPrueba implements Redactor {
  llamadas = 0;
  async redactar(prompt: string): Promise<string> {
    this.llamadas++;
    const autor = prompt.match(/Reseña de ([^:]+):/)?.[1] ?? "anon";
    return `Respuesta para ${autor}.`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cierre punto 2: marcar dos veces no duplica ni cambia la fecha
// ─────────────────────────────────────────────────────────────────────────────

test("RS.15 punto 2: marcar dos veces la misma respuesta no la duplica", async () => {
  const alm = new AlmacenRespuestasEnMemoria();
  const clave = "abc123";
  await alm.guardar(clave, "texto cualquiera");
  const marcador = new MarcarRespuestasPublicadas(alm);

  await marcador.publicar(clave);
  await marcador.publicar(clave);

  const publicadas = await marcador.recuperarPublicadas();
  assert.equal(publicadas.length, 1);
  assert.equal(publicadas[0]!.clave, clave);
});

test("RS.15 punto 2: la segunda marca no sobrescribe la fecha de la primera", async () => {
  const alm = new AlmacenRespuestasEnMemoria();
  const clave = "abc123";
  const marcador = new MarcarRespuestasPublicadas(alm);
  await alm.guardar(clave, "texto");

  await marcador.publicar(clave);
  const primera = await marcador.recuperarPublicadas();

  await new Promise((r) => setTimeout(r, 10));

  await marcador.publicar(clave);
  const segunda = await marcador.recuperarPublicadas();

  assert.equal(segunda[0]!.publicadoEn, primera[0]!.publicadoEn);
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre punto 3: lo marcado sobrevive a cerrar y reabrir el almacén SQLite
// ─────────────────────────────────────────────────────────────────────────────

test("RS.15 punto 3: lo marcado sobrevive a cerrar y reabrir el almacén SQLite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rs15-"));
  try {
    const ruta = join(dir, "cache.db");

    // Primera sesión: procesar reseñas y marcar una como publicada.
    const redactor1 = new RedactorFalsoPrueba();
    const alm1 = new AlmacenRespuestasSqlite(ruta);
    const marcador1 = new MarcarRespuestasPublicadas(alm1);
    const decorado1 = new RedactorConMemoria(redactor1, alm1);

    const r1 = reseña("Ana", 4);
    const r2 = reseña("Luis", 2);
    await procesarLote([r1, r2], ficha, decorado1);

    const claveR1 = claveDePrompt(`Reseña de Ana: ${r1.texto}\nNegocio: ${ficha.nombre}`);
    await marcador1.publicar(claveR1);
    alm1.cerrar();

    // Segunda sesión: abrir el mismo archivo.
    const alm2 = new AlmacenRespuestasSqlite(ruta);
    const marcador2 = new MarcarRespuestasPublicadas(alm2);

    const publicadas = await marcador2.recuperarPublicadas();
    assert.equal(publicadas.length, 1);
    assert.equal(publicadas[0]!.clave, claveR1);

    alm2.cerrar();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RS.15 punto 3: los paquetes guardados antes de este ítem se siguen leyendo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rs15-"));
  try {
    const ruta = join(dir, "cache-sin-nueva-tabla.db");

    // Crear archivo con solo la tabla de RS.10 (simula versión anterior).
    const almViejo = new AlmacenRespuestasSqlite(ruta);
    await almViejo.guardar("clave-vieja", "respuesta vieja");
    almViejo.cerrar();

    // Abrir con la implementación nueva: CREATE TABLE IF NOT EXISTS no destruye.
    const almNuevo = new AlmacenRespuestasSqlite(ruta);
    const marcador = new MarcarRespuestasPublicadas(almNuevo);

    const texto = await almNuevo.buscar("clave-vieja");
    assert.equal(texto, "respuesta vieja");

    await marcador.publicar("clave-nueva");
    const publicadas = await marcador.recuperarPublicadas();
    assert.equal(publicadas.length, 1);
    assert.equal(publicadas[0]!.clave, "clave-nueva");

    almNuevo.cerrar();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre punto 1: separarPublicadasYNuevas divide las filas del paquete
// ─────────────────────────────────────────────────────────────────────────────

function filaPrueba(autor: string): FilaPaquete {
  return {
    indice: 0,
    autor,
    estrellas: 4,
    fecha: "2024-03-01",
    textoResena: `Reseña de ${autor}`,
    estado: "lista",
    respuesta: `Respuesta para ${autor}.`,
    motivo: "",
    idioma: "es",
    intentosDeInyeccion: 0,
  };
}

test("RS.15 punto 1: separarPublicadasYNuevas devuelve dos bloques, sin mezcla", () => {
  const filas = [filaPrueba("Ana"), filaPrueba("Luis"), filaPrueba("María")];
  const publicadas = new Set<string>(["Ana"]);

  const { publicadas: pubs, nuevas } = separarPublicadasYNuevas(filas, publicadas);

  assert.equal(pubs.length, 1);
  assert.equal(pubs[0]!.autor, "Ana");
  assert.equal(nuevas.length, 2);
  assert.ok(nuevas.every((f) => f.autor !== "Ana"));
});

test("RS.15 punto 1: autor no publicado devuelve todo como nuevas", () => {
  const filas = [filaPrueba("Ana")];
  const { publicadas, nuevas } = separarPublicadasYNuevas(filas, new Set(["otro"]));
  assert.equal(publicadas.length, 0);
  assert.equal(nuevas.length, 1);
});

test("RS.15 punto 1: todas publicadas devuelve nuevo bloque vacío", () => {
  const filas = [filaPrueba("Ana"), filaPrueba("Luis")];
  const { publicadas, nuevas } = separarPublicadasYNuevas(
    filas,
    new Set(["Ana", "Luis"]),
  );
  assert.equal(publicadas.length, 2);
  assert.equal(nuevas.length, 0);
});