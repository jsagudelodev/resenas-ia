// RS.8 — El lote entero, de una vez.
//
// `procesarLote` recibe la lista de reseñas que devuelve `convertirReseñas`,
// la ficha del negocio y un redactor, y devuelve un resultado por reseña en
// el mismo orden en que entraron más los conteos agregados. Una reseña que
// lance una excepción NO tumba el lote (punto 2 del cierre): la excepción se
// contiene y la reseña queda marcada como `noDisponible` con el motivo del
// error, de manera que las demás siguen produciendo su respuesta.

import type { ReseñaNegocio } from "./convertirReseñas.js";
import type { FichaNegocio } from "./fichaNegocio.js";
import type { Redactor } from "./redactor.js";
import {
  generarRespuesta,
  type ResultadoRedaccion,
} from "./generarRespuesta.js";

export interface ResultadoProcesamientoLote {
  /**
   * Una entrada por reseña de entrada, **en el mismo orden**. Cada elemento
   * es el resultado de `generarRespuesta` para esa reseña o, si hubo una
   * excepción no capturada en el procesamiento, un `RespuestaNoDisponible`
   * con el motivo del error para que el lote siga entero.
   */
  resultados: ReadonlyArray<ResultadoRedaccion>;
  /** Reseñas que quedaron como respuesta lista para pegar. */
  listas: number;
  /** Reseñas marcadas para revisión humana (acusación grave). */
  paraRevision: number;
  /** Reseñas que no pudieron entregarse (redactor cayó, revisión las retuvo, etc.). */
  fallaron: number;
}

/**
 * Procesa un lote entero de reseñas. Recorre la lista en orden y, por cada
 * reseña, llama a `generarRespuesta` envolviéndola en un `try`/`catch` por
 * si algo se escapa del manejo interno (la función ya contiene errores del
 * redactor, pero defensivamente se vuelve a envolver). El conteo se calcula
 * discriminando `ResultadoRedaccion`.
 *
 * El orden de `resultados` es el mismo que el de `reseñas`: se hace por
 * índice, no por `Promise.all` (que podría reordenar).
 */
export async function procesarLote(
  reseñas: ReadonlyArray<ReseñaNegocio>,
  ficha: FichaNegocio,
  redactor: Redactor,
): Promise<ResultadoProcesamientoLote> {
  const resultados: ResultadoRedaccion[] = [];

  for (let i = 0; i < reseñas.length; i++) {
    const reseña = reseñas[i];
    if (reseña === undefined) {
      // `noUncheckedIndexedAccess`: no debería pasar (reseñas.length lo
      // descarta), pero la guarda deja claro que el índice es válido.
      continue;
    }
    let resultado: ResultadoRedaccion;
    try {
      resultado = await generarRespuesta(reseña, ficha, redactor);
    } catch (error: unknown) {
      const motivo = error instanceof Error
        ? `el lote no pudo procesar la reseña ${i}: ${error.message}`
        : `el lote no pudo procesar la reseña ${i}: error desconocido.`;
      resultado = {
        noDisponible: true,
        motivo,
        idioma: ficha.idiomaPorDefecto,
        intentoDeInyeccion: [],
      };
    }
    resultados.push(resultado);
  }

  let listas = 0;
  let paraRevision = 0;
  let fallaron = 0;
  for (const r of resultados) {
    if ("texto" in r) {
      listas += 1;
    } else if ("revisionHumana" in r) {
      paraRevision += 1;
    } else {
      fallaron += 1;
    }
  }

  return { resultados, listas, paraRevision, fallaron };
}