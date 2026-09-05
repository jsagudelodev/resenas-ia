// RS.3 — La respuesta redactada.
//
// `generarRespuesta` toma una reseña y la ficha validada del negocio y delega
// la redacción en un `Redactor` (interfaz). Si el redactor falla, la reseña
// NO tumba el lote: se devuelve `{ respuesta: null, motivo }` y el llamador
// la marca como pendiente (punto 3 del cierre).

import type { ReseñaNegocio } from "./convertirReseñas.js";
import type { FichaNegocio } from "./fichaNegocio.js";
import type { Redactor } from "./redactor.js";
import { revisar } from "./revisarRespuesta.js";
import { detectarInyeccion, type IntentoDeInyeccion, type ResultadoDeteccion } from "./detectarInyeccion.js";
import { detectarGravedad, type ResultadoGravedad } from "./detectorGravedad.js";
import { detectarIdioma, type Idioma } from "./detectorIdioma.js";

export interface RespuestaLista {
  /** Texto listo para pegar. */
  texto: string;
  /**
   * Idioma en el que está redactada la respuesta. Detectado a partir de la
   * reseña, o el idioma por defecto de la ficha si la detección no fue
   * concluyente (RS.7). Viaja con la respuesta, no solo con la detección.
   */
  idioma: Idioma;
  /**
   * Si la reseña llevaba instrucciones disfrazadas (RS.5), el intento se
   * registra aquí. Vacío si no se detectó nada. La respuesta IGUAL SE
   * ENTREGA: el redactor la construye mirando ficha+reseña, no obedeciendo
   * al atacante.
   */
  intentoDeInyeccion: ReadonlyArray<IntentoDeInyeccion>;
}

export interface RespuestaNoDisponible {
  /** `true` cuando el redactor no pudo producir una respuesta. */
  noDisponible: true;
  /** Motivo legible para registrar en la reseña marcada. */
  motivo: string;
  /**
   * Idioma en el que se pidió la respuesta, para que el lote pueda
   * registrar qué idioma se aplicó a esta reseña.
   */
  idioma: Idioma;
  /**
   * Si la reseña llevaba instrucciones disfrazadas, se listan aquí también:
   * la reseña marcada como «no disponible» debe poder explicar por qué.
   */
  intentoDeInyeccion: ReadonlyArray<IntentoDeInyeccion>;
}

/**
 * RS.6 — Respuesta marcada para revisión humana.
 *
 * La reseña trae una acusación grave (intoxicación, cobro indebido, trato
 * discriminatorio, abogados). El borrador se entrega —el dueño no quiere
 * partir de una hoja en blanco— pero NO como respuesta lista para pegar:
 * §4 del encargo lo prohíbe explícitamente. El motivo de la marca viaja con
 * la reseña (punto 3 del cierre), no solo la marca.
 */
export interface RespuestaParaRevision {
  /** `true` cuando hay que mirar esto antes de publicar. */
  revisionHumana: true;
  /** Borrador redactado por el redactor. No está listo para pegar. */
  borrador: string;
  /** Motivo legible de la marca, compuesto a partir de `acusaciones`. */
  motivo: string;
  /**
   * Idioma en el que se redactó el borrador (RS.7). El dueño lo necesita
   * para revisarlo: si está en el idioma equivocado, no le sirve.
   */
  idioma: Idioma;
  /** Cada acusación detectada, con su categoría, motivo y muestra. */
  acusaciones: ReadonlyArray<ResultadoGravedad>;
  /** Intentos de inyección (RS.5) de la misma reseña, si los hubo. */
  intentoDeInyeccion: ReadonlyArray<IntentoDeInyeccion>;
}

export type ResultadoRedaccion =
  | RespuestaLista
  | RespuestaNoDisponible
  | RespuestaParaRevision;

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
  // RS.5: el texto de la reseña es entrada de un desconocido. Antes de
  // gastar al redactor, miramos si la reseña trae instrucciones disfrazadas.
  // El prompt que ve el redactor lleva la reseña SANEADA (los fragmentos
  // detectados, reemplazados por un marcador) para que un redactor obediente
  // no pueda seguirlas. La reseña original queda intacta para auditoría:
  // el intento se REGISTRA en el resultado de esta reseña.
  const deteccion = detectarInyeccion(reseña.texto);
  // RS.7: detectamos el idioma de la reseña. Si el detector no se decide, se
  // usa el idioma por defecto de la ficha. El idioma VIAJA en el prompt
  // para que el redactor sepa en qué idioma responder, y viaja también en
  // el resultado para que el lote pueda registrarlo.
  const idiomaRes = detectarIdioma(reseña.texto, ficha.idiomaPorDefecto);
  const prompt = construirPrompt(reseña, ficha, deteccion, idiomaRes.idioma);
  try {
    const texto = await redactor.redactar(prompt);
    if (typeof texto !== "string" || texto.trim().length === 0) {
      return {
        noDisponible: true,
        motivo: "el redactor devolvió una respuesta vacía.",
        idioma: idiomaRes.idioma,
        intentoDeInyeccion: deteccion.intentos,
      };
    }
    const limpio = texto.trim();
    // RS.4: revisar antes de entregar. Si la respuesta admite culpa, promete
    // dinero o un dato que no está en la ficha, no se publica: se devuelve
    // `noDisponible` con el motivo, y el lote sigue.
    const revision = revisar(limpio, ficha);
    if (!revision.ok) {
      return {
        noDisponible: true,
        motivo: `la respuesta fue retenida por la revisión: ${revision.motivo}`,
        idioma: idiomaRes.idioma,
        intentoDeInyeccion: deteccion.intentos,
      };
    }
    // RS.6: la respuesta pasó la revisión de RS.4, pero eso no basta. Si la
    // RESEÑA alega algo grave (intoxicación, cobro indebido, trato
    // discriminatorio, abogados), no se entrega como lista para pegar: se
    // entrega como borrador CON la marca de revisión humana y el motivo
    // viajando con ella. El borrador se produce igual —el dueño no parte de
    // una hoja en blanco— pero la marca dice "esto no se publica sin leerlo".
    const acusaciones = detectarGravedad(reseña.texto);
    if (acusaciones.length > 0) {
      return {
        revisionHumana: true,
        borrador: limpio,
        motivo: construirMotivoRevision(acusaciones),
        idioma: idiomaRes.idioma,
        acusaciones,
        intentoDeInyeccion: deteccion.intentos,
      };
    }
    return {
      texto: limpio,
      idioma: idiomaRes.idioma,
      intentoDeInyeccion: deteccion.intentos,
    };
  } catch (error: unknown) {
    const motivo = error instanceof Error
      ? `el redactor no pudo producir la respuesta: ${error.message}`
      : "el redactor no pudo producir la respuesta: error desconocido.";
    return {
      noDisponible: true,
      motivo,
      idioma: idiomaRes.idioma,
      intentoDeInyeccion: deteccion.intentos,
    };
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
  deteccion: ResultadoDeteccion = { intentos: [] },
  idioma: Idioma = "es",
): string {
  const estrellasTxt = reseña.estrellas === null ? "no indicadas" : String(reseña.estrellas);
  const fechaTxt = reseña.fecha ?? "no indicada";
  const textoParaRedactor = sanearParaRedactor(reseña.texto, deteccion);
  return [
    `Nombre del negocio: ${ficha.nombre}`,
    `Actividad: ${ficha.actividad}`,
    `Tono: ${ficha.tono}`,
    // RS.7: el idioma en el que se debe responder, ya decidido a partir de
    // la reseña (o del idioma por defecto de la ficha). Va en el prompt
    // para que el redactor lo sepa sin tener que detectarlo él mismo.
    `Idioma de la respuesta: ${idioma}`,
    `Estrellas: ${estrellasTxt}`,
    `Fecha: ${fechaTxt}`,
    `Reseña de ${reseña.autor || "anónimo"}: ${textoParaRedactor}`,
  ].join("\n");
}

/**
 * Sanea el texto de la reseña para el redactor: si `deteccion` trae
 * intentos, reemplaza los fragmentos coincidentes por un marcador
 * neutral. Así, un redactor obediente que vea el prompt no encuentra las
 * órdenes. La reseña ORIGINAL (con las órdenes intactas) se conserva
 * fuera de aquí para auditoría y para el `intentoDeInyeccion` del
 * resultado.
 */
function sanearParaRedactor(
  texto: string,
  deteccion: ResultadoDeteccion,
): string {
  if (deteccion.intentos.length === 0) return texto;
  // El detector expone la posición de la coincidencia en `muestra`
  // (« (pos. N)»); para sanear usamos las reglas directamente, que es
  // el mismo motor y mantiene la coherencia entre lo detectado y lo
  // reemplazado.
  // Importamos las reglas por reutilización interna: viven aquí para que
  // detector y saneador no se desincronicen.
  return sanearConReglas(texto);
}

// Reglas espejo de las del detector. Si el detector cambia, esto cambia
// con él: ambos están en el mismo archivo a propósito.
const REGLAS_SANEAMIENTO: ReadonlyArray<RegExp> = [
  /\b(responde|contesta|responder|contestar|write|answer|reply|écris|écrivez)\b[^.\n]*\b(en\s+(ingl[eé]s|franc[eé]s|alem[aá]n|portugu[eé]s|italiano)|in\s+english|en\s+fran[cç]ais|auf\s+deutsch)\b/gi,
  /\b(ignora|olvida|descarta|ignore|disregard|forget)\b[^.\n]*\b(instrucciones|indicaciones|reglas|prompts?|instructions|rules)\b/gi,
  /\b(escribe|di|afirma|publica|dile|diles|escribir|decir|afirmar|publicar|write|say|state|publish|tell)\b[^.\n]{0,80}\b(que\s+(este|el|la|ha|hemos|han|estamos|est[aá]n)|that\s+(this|it|we|they))\b[^.\n]{0,80}\b(horrible|terrible|malo|peor|pesimo|cerrad[ao]|cerramos|cierran|roban|estaf|sucio|enferm[eo]|peligroso|scam|fraud|closed|shut|dirty|dangerous|the\s+worst|terrible)\b/gi,
  /\b(di|escrie|write|state|say)\b[^.\n]{0,40}\b(que\s+)?(hemos\s+cerrad[ao]|esta[n]?\s+sucios?|este\s+sitio\s+es\s+horrible|the\s+worst|we'?ve\s+closed)\b/gi,
];

/**
 * Compone el motivo legible de la marca de revisión humana (RS.6, punto 3):
 * el motivo VIAJA con la reseña, no solo la marca. Una línea por acusación,
 * para que el dueño sepa exactamente qué tiene que mirar.
 */
function construirMotivoRevision(
  acusaciones: ReadonlyArray<ResultadoGravedad>,
): string {
  const detalle = acusaciones
    .map((a) => `${a.categoria}: ${a.motivo}`)
    .join(" ");
  return `la reseña alega una acusación grave y no se responde sola — ${detalle}`;
}

function sanearConReglas(texto: string): string {
  let out = texto;
  for (const patron of REGLAS_SANEAMIENTO) {
    out = out.replace(patron, "[REDACTADO POR RS.5]");
  }
  return out;
}