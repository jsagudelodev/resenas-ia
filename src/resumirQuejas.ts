// RS.9 — El resumen de qué se queja la gente.
//
// `resumirQuejas` recibe el resultado de un lote (lo que devuelve
// `procesarLote` en `src/procesarLote.ts`) y devuelve los motivos que se
// repiten en el lote, con la cantidad de reseñas por motivo y la lista
// rastreable de los índices de las reseñas que componen cada motivo. Sin
// red, sin SDK, sin LLM: solo cuenta y agrupa.
//
// Por qué se agrupa por la cadena de `motivo` del `ResultadoRedaccion`:
// cada `ResultadoRedaccion` ya viaja con su motivo legible (la acusación
// detectada por RS.6, el motivo de no disponibilidad de RS.3/RS.4 o, para
// las respuestas listas, sin motivo). Dos reseñas con la misma cadena de
// motivo hablan de lo mismo desde el punto de vista del lote: la queja se
// repite. Si los motivos son distintos, son quejas distintas.
//
// Reglas del cierre:
//   1. "los motivos que se repiten y cuántas reseñas hay en cada uno".
//      → `motivos` con `cantidad` por motivo.
//   2. "cada cifra se puede rastrear: por cada motivo se puede pedir la
//      lista de reseñas que lo componen".
//      → `motivos` con `indices: ReadonlyArray<number>` por motivo.
//   3. "no inventa: con dos reseñas no dice que haya un patrón, dice que
//      no hay suficientes".
//      → un motivo con menos de `umbralMinimo` (por defecto 2) no aparece
//      en el resumen; con un lote sin repeticiones, el resumen queda
//      vacío.

import type { ResultadoRedaccion } from "./generarRespuesta.js";
import type { ResultadoProcesamientoLote } from "./procesarLote.js";

/** Mínimo de reseñas que comparten un motivo para que el motivo aparezca
 *  en el resumen. Por debajo de este umbral, se considera que "no hay
 *  suficientes" (punto 3 del cierre). */
export const UMBRAL_MINIMO_DEFECTO = 2;

/** Un motivo repetido en el lote, con el conteo y los índices
 *  rastreables. */
export interface MotivoQueja {
  /** Cadena del motivo tal y como viaja en `ResultadoRedaccion.motivo`. */
  motivo: string;
  /** Cuántas reseñas del lote comparten este motivo. */
  cantidad: number;
  /** Índices (0-based, en el orden del lote) de las reseñas que
   *  componen este motivo. Permite rastrear cada cifra (punto 2). */
  indices: ReadonlyArray<number>;
}

/** Resumen de qué se queja la gente en un lote procesado. */
export interface ResumenDeQuejas {
  /** Motivos repetidos en el lote (al menos `umbralMinimo` cada uno). */
  motivos: ReadonlyArray<MotivoQueja>;
  /** Total de reseñas del lote. */
  totalReseñas: number;
  /** Cuántos motivos repetidos se detectaron (tamaño de `motivos`). */
  cantidadMotivos: number;
  /**
   * `true` cuando el lote no tiene suficientes repeticiones como para
   * hablar de patrón. El lote por debajo de `umbralMinimo * 2` reseñas
   * nunca puede tener un motivo repetido (no hay suficientes).
   */
  sinSuficientes: boolean;
  /** Umbral aplicado al resumen. Útil para reportarlo en el resultado. */
  umbralMinimo: number;
}

/**
 * Cuenta los motivos repetidos en el resultado de un lote. Pura: no
 * modifica el resultado, no llama a red ni al LLM.
 *
 * El motivo de cada `ResultadoRedaccion` se toma del campo `motivo` que
 * viaja en la reseña marcada (`RespuestaParaRevision.motivo` para
 * acusaciones graves; `RespuestaNoDisponible.motivo` para redactor caído o
 * revisión retenida). Las respuestas listas NO traen motivo de queja: se
 * ignoran (no entran en el conteo).
 */
export function resumirQuejas(
  lote: ResultadoProcesamientoLote,
  umbralMinimo: number = UMBRAL_MINIMO_DEFECTO,
): ResumenDeQuejas {
  const totalReseñas = lote.resultados.length;

  // Caso degenerado: umbral inválido. Mejor fallar explícito que devolver
  // un resumen mentiroso.
  if (!Number.isInteger(umbralMinimo) || umbralMinimo < 1) {
    throw new Error(
      `RS.9: el umbral mínimo debe ser un entero ≥ 1 (recibido ${umbralMinimo}).`,
    );
  }

  // Mapa motivo → índices (preserva orden de aparición).
  const porMotivo = new Map<string, number[]>();

  for (let i = 0; i < lote.resultados.length; i++) {
    const r = lote.resultados[i];
    if (r === undefined) continue;
    const motivo = motivoDeResultado(r);
    if (motivo === null) continue;
    const lista = porMotivo.get(motivo);
    if (lista === undefined) {
      porMotivo.set(motivo, [i]);
    } else {
      lista.push(i);
    }
  }

  // Filtrar los que alcanzan el umbral y construir el array final en
  // orden de primera aparición (estable).
  const motivos: MotivoQueja[] = [];
  for (const [motivo, indices] of porMotivo) {
    if (indices.length >= umbralMinimo) {
      motivos.push({ motivo, cantidad: indices.length, indices });
    }
  }

  const sinSuficientes = motivos.length === 0;

  return {
    motivos,
    totalReseñas,
    cantidadMotivos: motivos.length,
    sinSuficientes,
    umbralMinimo,
  };
}

/**
 * Devuelve el motivo de queja del resultado, o `null` si no aplica.
 *
 * - `RespuestaParaRevision`: el motivo de la acusación grave (RS.6).
 * - `RespuestaNoDisponible`: el motivo por el que no se pudo entregar
 *   (RS.3 / RS.4).
 * - `RespuestaLista`: no es una queja — se ignora.
 */
function motivoDeResultado(r: ResultadoRedaccion): string | null {
  if ("revisionHumana" in r) {
    return r.motivo;
  }
  if ("noDisponible" in r) {
    return r.motivo;
  }
  // RespuestaLista: sin motivo de queja.
  return null;
}