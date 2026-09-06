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
import type { RegistradorSeguro } from "./registro.js";
import type { ServicioSaldoCliente } from "./saldoCliente.js";

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
 * Resultado de procesar un lote junto con la operación de saldo asociada.
 */
export interface LoteProcesado {
  resultado: ResultadoProcesamientoLote;
  /** `true` cuando el saldo era suficiente y el descuento se aplicó. */
  saldoOk: boolean;
  /**
   * Solo presente cuando `saldoOk` es `false`. Número de respuestas que el
   * cliente tendría que comprar para cubrir este lote.
   */
  faltantes?: number;
}

/**
 * Procesa un lote entero de reseñas. Recorre la lista en orden y, por cada
 * reseña, llama a `generarRespuesta` envolviéndola en un `try`/`catch` por
 * si algo se escapa del manejo interno (la función ya contiene errores del
 * redactor, pero defensivamente se vuelve a envolver). El conteo se calcula
 * discriminando `ResultadoRedaccion`.
 *
 * Si se pasa un `ServicioSaldoCliente` con un `idCliente`, el saldo se
 * descuenta ANTES de procesar para rechazar lotes que el cliente no puede
 * pagar (punto 2 del cierre de RS.16: gastar en un lote que no se va a
 * entregar es peor que rechazarlo). El descuento se calcula sobre `listas`
 * únicamente: las marcadas para revisión humana NO se cobran (punto 1 del
 * cierre: no se entregó nada usable).
 *
 * El orden de `resultados` es el mismo que el de `reseñas`: se hace por
 * índice, no por `Promise.all` (que podría reordenar).
 */
export async function procesarLote(
  reseñas: ReadonlyArray<ReseñaNegocio>,
  ficha: FichaNegocio,
  redactor: Redactor,
  regs: RegistradorSeguro | null = null,
  saldo?: { servicio: ServicioSaldoCliente; idCliente: string },
): Promise<LoteProcesado> {
  const resultados: ResultadoRedaccion[] = [];

  for (let i = 0; i < reseñas.length; i++) {
    const reseña = reseñas[i];
    if (reseña === undefined) {
      // `noUncheckedIndexedAccess`: no debería pasar (reseñas.length lo
      // descarta), pero la guarda deja claro que el índice es válido.
      continue;
    }
    if (regs !== null) {
      regs.registrar({
        nivel: "info",
        mensaje: `procesando reseña ${i} del lote.`,
        contexto: { indice: i, estrellas: reseña.estrellas, fecha: reseña.fecha },
      });
    }
    let resultado: ResultadoRedaccion;
    try {
      resultado = await generarRespuesta(reseña, ficha, redactor, regs);
    } catch (error: unknown) {
      const motivo = error instanceof Error
        ? `el lote no pudo procesar la reseña ${i}: ${error.message}`
        : `el lote no pudo procesar la reseña ${i}: error desconocido.`;
      if (regs !== null) {
        regs.registrar({
          nivel: "error",
          mensaje: motivo,
          contexto: { indice: i },
        });
      }
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

  // RS.16: verificar saldo antes de procesar.
  if (saldo !== undefined) {
    const disponibles = saldo.servicio.consultar(saldo.idCliente);
    if (disponibles.respuestas < listas) {
      return {
        resultado: { resultados, listas, paraRevision, fallaron },
        saldoOk: false,
        faltantes: listas - disponibles.respuestas,
      };
    }
    saldo.servicio.descontar(saldo.idCliente, listas);
  }

  return {
    resultado: { resultados, listas, paraRevision, fallaron },
    saldoOk: true,
  };
}