// RS.4 — La respuesta que no se puede publicar.
//
// Este es el criterio de vendible, y no se cumple pidiéndoselo al modelo: hay
// que REVISAR la salida antes de entregarla. Una respuesta que admite culpa,
// promete dinero o un descuento, o afirma un dato que no está en la ficha, NO
// se entrega.
//
// `revisar(texto, ficha)` es síncrona, no llama a ningún modelo, y devuelve
// `{ ok: true }` si la respuesta se puede publicar, o `{ ok: false, motivo }`
// con un motivo legible si hay que retenerla. El llamador (típicamente
// `generarRespuesta`) marca la reseña en consecuencia.

import type { FichaNegocio } from "./fichaNegocio.js";

export interface RevisionOk {
  ok: true;
}

export interface RevisionRechazada {
  ok: false;
  motivo: string;
}

export type ResultadoRevision = RevisionOk | RevisionRechazada;

// ─────────────────────────────────────────────────────────────────────────────
// Reglas de redacción prohibidas (punto 1 del cierre de RS.4).
// Cada patrón es una expresión regular case-insensitive que, si aparece en la
// respuesta, la marca como no publicable. La lista se queda corta a propósito:
// mejor un falso negativo revisable a mano que un falso positivo que tape
// respuestas correctas.
// ─────────────────────────────────────────────────────────────────────────────

const PROHIBIDAS: ReadonlyArray<{ patron: RegExp; motivo: string }> = [
  // Devolver dinero / reembolso.
  {
    patron: /\b(le\s+)?(devolvemos?|reembolsamos?|devolv[íi]mos?le)\b[^.]*\bdinero\b/i,
    motivo: "la respuesta promete devolver dinero.",
  },
  {
    patron: /\bdevoluci[óo]n\s+(en\s+)?(efectivo|dinero)\b/i,
    motivo: "la respuesta promete devolución en efectivo o dinero.",
  },
  // Regalar / invitar la próxima vez (descuento encubierto).
  {
    patron: /\b(regalamos?|invitamos?|ofrecemos?)\b[^.]*\b(pr[óo]xim[ao]|siguiente)\b/i,
    motivo: "la respuesta promete regalar o invitar la próxima visita.",
  },
  // Descuento directo.
  {
    patron: /\b(descuento|rebaja|cup[óo]n|vale)\b/i,
    motivo: "la respuesta menciona un descuento o vale.",
  },
  // Admitir culpa explícitamente (un «lo sentimos» normal sí pasa; este es
  // un reconocimiento de responsabilidad que puede usarse en contra).
  {
    patron: /\b(asumimos\s+(toda\s+)?la\s+responsabilidad|fue\s+culpa\s+nuestra|nuestra\s+culpa)\b/i,
    motivo: "la respuesta admite una responsabilidad que no se puede demostrar.",
  },
  // Compensación económica genérica.
  {
    patron: /\b(compensaci[óo]n\s+econ[óo]mica|indemnizaci[óo]n)\b/i,
    motivo: "la respuesta menciona compensación o indemnización económica.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Datos que la respuesta puede mencionar (punto 2 del cierre de RS.4).
// La ficha lleva contacto y nombre del negocio. Si la respuesta contiene un
// teléfono, un horario o una URL que NO está en la ficha, es un dato
// inventado por el modelo y la respuesta NO se entrega.
// ─────────────────────────────────────────────────────────────────────────────

/** Devuelve el conjunto de hechos conocidos que la ficha avala. */
function hechosConocidos(ficha: FichaNegocio): ReadonlySet<string> {
  const hechos = new Set<string>();
  if (ficha.nombre.length > 0) {
    hechos.add(ficha.nombre.toLowerCase());
  }
  if (ficha.actividad.length > 0) {
    hechos.add(ficha.actividad.toLowerCase());
  }
  // RS.11: si la ficha lleva sucursal, su nombre y su dirección son
  // hechos conocidos por la ficha: el redactor los puede mencionar sin
  // que el revisor los rechace como dato inventado.
  if (ficha.sucursal !== undefined) {
    hechos.add(ficha.sucursal.nombre.toLowerCase());
    if (ficha.sucursal.direccion !== undefined && ficha.sucursal.direccion.length > 0) {
      hechos.add(ficha.sucursal.direccion.toLowerCase());
    }
  }
  const c = ficha.contacto;
  if (c.telefono !== undefined && c.telefono.length > 0) {
    hechos.add(c.telefono.toLowerCase());
  }
  if (c.correo !== undefined && c.correo.length > 0) {
    hechos.add(c.correo.toLowerCase());
  }
  if (c.direccion !== undefined && c.direccion.length > 0) {
    hechos.add(c.direccion.toLowerCase());
  }
  if (c.web !== undefined && c.web.length > 0) {
    hechos.add(c.web.toLowerCase());
  }
  return hechos;
}

/** Busca teléfonos (3+ dígitos con separadores) en el texto. */
function telefonosEn(texto: string): string[] {
  const out: string[] = [];
  const patron = /\b(\d{3,4}[-\s.]?\d{3,4}[-\s.]?\d{0,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = patron.exec(texto)) !== null) {
    const t = (m[1] ?? "").trim();
    if (t.length >= 7) {
      out.push(t);
    }
  }
  return out;
}

/** Busca horarios tipo "de 9:00 a 22:00", "de 9 a 18", "abrimos de 10:30 a 23:00". */
function horariosEn(texto: string): string[] {
  const out: string[] = [];
  // "de HH a HH" o "de HH:MM a HH:MM" (con o sin "hasta").
  const patron = /\bde\s+(\d{1,2}(?::\d{2})?)\s*(?:a|hasta)\s+(\d{1,2}(?::\d{2})?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = patron.exec(texto)) !== null) {
    const a = (m[1] ?? "").trim();
    const b = (m[2] ?? "").trim();
    if (a.length > 0 && b.length > 0) {
      out.push(`${a}-${b}`);
    }
  }
  return out;
}

/** Busca URLs http(s)://, www., o dominios tipo algo.com. */
function urlsEn(texto: string): string[] {
  const out: string[] = [];
  const patron = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z]{2,})+(?:\/[^\s]*)?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = patron.exec(texto)) !== null) {
    const u = (m[1] ?? "").trim();
    // Filtrar falsos positivos triviales: "etc" y cosas sin punto y TLD.
    if (u.includes(".")) {
      out.push(u.toLowerCase());
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Función pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Revisa si una respuesta puede entregarse al dueño del negocio.
 *
 * Devuelve `{ ok: true }` si pasa las reglas, o `{ ok: false, motivo }` con
 * una explicación legible si la respuesta:
 *   1. Admite culpa, promete dinero o un descuento (palabras clave).
 *   2. Incluye un teléfono, horario o URL que no está en la ficha.
 *
 * Es síncrona y no llama a ningún modelo.
 */
export function revisar(
  texto: string,
  ficha: FichaNegocio,
): ResultadoRevision {
  if (typeof texto !== "string" || texto.trim().length === 0) {
    return { ok: false, motivo: "la respuesta está vacía." };
  }

  // (1) Patrones prohibidos.
  for (const regla of PROHIBIDAS) {
    if (regla.patron.test(texto)) {
      return { ok: false, motivo: regla.motivo };
    }
  }

  // (2) Datos que no están en la ficha.
  const conocidos = hechosConocidos(ficha);

  for (const t of telefonosEn(texto)) {
    if (!conocidos.has(t.toLowerCase())) {
      return {
        ok: false,
        motivo: `la respuesta menciona un teléfono (${t}) que no está en la ficha.`,
      };
    }
  }
  for (const h of horariosEn(texto)) {
    if (!conocidos.has(h.toLowerCase())) {
      return {
        ok: false,
        motivo: `la respuesta menciona un horario (${h}) que no está en la ficha.`,
      };
    }
  }
  for (const u of urlsEn(texto)) {
    if (!conocidos.has(u)) {
      return {
        ok: false,
        motivo: `la respuesta menciona una web o URL (${u}) que no está en la ficha.`,
      };
    }
  }

  return { ok: true };
}