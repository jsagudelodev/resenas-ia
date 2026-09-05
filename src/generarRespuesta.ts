// RS.3 — La respuesta redactada.
//
// `generarRespuesta` toma una reseña y la ficha validada del negocio y delega
// la redacción en un `Redactor` (interfaz). Si el redactor falla, la reseña
// NO tumba el lote: se devuelve `{ respuesta: null, motivo }` y el llamador
// la marca como pendiente (punto 3 del cierre).

import type { ReseñaNegocio } from "./convertirReseñas.js";
import type { FichaNegocio } from "./fichaNegocio.js";
import type { Redactor } from "./redactor.js";

export interface RespuestaLista {
  /** Texto listo para pegar. */
  texto: string;
}

export interface RespuestaNoDisponible {
  /** `true` cuando el redactor no pudo producir una respuesta. */
  noDisponible: true;
  /** Motivo legible para registrar en la reseña marcada. */
  motivo: string;
}

export type ResultadoRedaccion = RespuestaLista | RespuestaNoDisponible;

/**
 * Redacta una respuesta a una reseña usando el redactor que se le pasa.
 *
 * - Devuelve `{ texto }` si el redactor produce la respuesta.
 * - Si el redactor lanza (sin red, sin credenciales, lo que sea), captura el
 *   fallo y devuelve `{ noDisponible: true, motivo }` — el lote sigue.
 *
 * El prompt que se pasa al redactor incluye nombre del negocio, estrellas y
 * texto de la reseña: el redactor decide qué hacer con eso. Sustituible sin
 * tocar esta función (punto 2 del cierre).
 */
export async function generarRespuesta(
  reseña: ReseñaNegocio,
  ficha: FichaNegocio,
  redactor: Redactor,
): Promise<ResultadoRedaccion> {
  const prompt = construirPrompt(reseña, ficha);
  try {
    const texto = await redactor.redactar(prompt);
    if (typeof texto !== "string" || texto.trim().length === 0) {
      return {
        noDisponible: true,
        motivo: "el redactor devolvió una respuesta vacía.",
      };
    }
    return { texto: texto.trim() };
  } catch (error: unknown) {
    const motivo = error instanceof Error
      ? `el redactor no pudo producir la respuesta: ${error.message}`
      : "el redactor no pudo producir la respuesta: error desconocido.";
    return { noDisponible: true, motivo };
  }
}

/**
 * Construye el prompt que se envía al redactor. El `RedactorFalso` lo lee
 * buscando "Nombre del negocio:" y "Estrellas: N"; una implementación real
 * haría lo que considere con ese mismo texto.
 */
export function construirPrompt(
  reseña: ReseñaNegocio,
  ficha: FichaNegocio,
): string {
  const estrellasTxt = reseña.estrellas === null ? "no indicadas" : String(reseña.estrellas);
  const fechaTxt = reseña.fecha ?? "no indicada";
  return [
    `Nombre del negocio: ${ficha.nombre}`,
    `Actividad: ${ficha.actividad}`,
    `Tono: ${ficha.tono}`,
    `Estrellas: ${estrellasTxt}`,
    `Fecha: ${fechaTxt}`,
    `Reseña de ${reseña.autor || "anónimo"}: ${reseña.texto}`,
  ].join("\n");
}