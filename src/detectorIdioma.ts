// RS.7 — Responder en el idioma de la reseña.
//
// `detectarIdioma` mira el texto de la reseña y decide entre español ("es") e
// inglés ("en"). No se configura por lote (punto 2 del cierre): se decide
// mirando el texto. Si no hay suficiente evidencia para decidir (punto 3 del
// cierre — una reseña de tres palabras como «Muy bueno»), se devuelve el
// idioma por defecto de la ficha y se marca `confianza: "baja"` para que el
// llamador pueda registrar que se recurrió al fallback.
//
// Sin red ni SDK de IA: heurística sobre el texto, sin dependencias externas.

/** Idiomas que el detector sabe distinguir. Valor cerrado. */
export type Idioma = "es" | "en";

/** Resultado de mirar el texto de una reseña. */
export interface ResultadoDeteccionIdioma {
  idioma: Idioma;
  /**
   * `true` cuando el detector tuvo suficiente evidencia para decidir por el
   * texto. `false` cuando se recurrió al idioma por defecto de la ficha.
   */
  confianza: "alta" | "baja";
  /**
   * Si se usó el idioma por defecto, se incluye aquí el idioma de la ficha
   * para que el resultado de la reseña pueda decir qué idioma se aplicó.
   * Vacío cuando la detección fue alta.
   */
  motivo: string | null;
}

// Palabras funcionales muy comunes: si aparecen, el detector se inclina por
// ese idioma. Mantenemos la lista corta a propósito: solo palabras que casi
// nunca se usan en el otro idioma. "the" e "is" aparecen en frases
// españolas偶尔; "que"/"no"/"muy"/"es" son seña de identidad del español.
const SENALES_INGLES: ReadonlyArray<string> = [
  "the", "and", "was", "were", "is", "are", "very", "really",
  "great", "good", "bad", "terrible", "amazing", "love", "hate",
  "service", "food", "staff", "place", "went", "go", "come",
  "this", "that", "with", "for", "but", "not",
];
const SENALES_ESPANOL: ReadonlyArray<string> = [
  "que", "muy", "es", "no", "si", "pero", "con", "para",
  "por", "del", "los", "las", "una", "uno", "todo", "nada",
  "bien", "mal", "bueno", "buena", "malo", "mala", "excelente",
  "increible", "pesimo", "regular", "atencion", "servicio",
  "comida", "lugar", "fuimos", "fui", "voy",
  "este", "esta", "ese", "esa", "aqui", "alli",
];

/**
 * Decide el idioma de una reseña a partir de su texto.
 *
 * - Si el texto trae señales claras de un idioma, se devuelve ese con
 *   `confianza: "alta"`.
 * - Si no hay señales suficientes (o el texto es muy corto), se devuelve
 *   `idiomaPorDefecto` con `confianza: "baja"` y un motivo legible.
 * - Sin red ni SDK: solo cuenta señales en una lista corta de palabras
 *   funcionales.
 */
export function detectarIdioma(
  texto: string,
  idiomaPorDefecto: Idioma = "es",
): ResultadoDeteccionIdioma {
  const limpio = texto.trim().toLowerCase();
  if (limpio.length === 0) {
    return {
      idioma: idiomaPorDefecto,
      confianza: "baja",
      motivo: "la reseña está vacía; se usa el idioma por defecto de la ficha.",
    };
  }

  const tokens = limpiarTokens(limpio);
  if (tokens.length < 3) {
    // Muy poco texto: «Muy bueno», «Excelente», «Great», «Terrible». No
    // alcanza para decidir con confianza: usamos el idioma por defecto.
    return {
      idioma: idiomaPorDefecto,
      confianza: "baja",
      motivo:
        "la reseña es demasiado corta para decidir el idioma; se usa el idioma por defecto de la ficha.",
    };
  }

  let puntosEs = 0;
  let puntosEn = 0;
  for (const tok of tokens) {
    if (SENALES_ESPANOL.includes(tok)) puntosEs++;
    if (SENALES_INGLES.includes(tok)) puntosEn++;
  }

  if (puntosEs === 0 && puntosEn === 0) {
    return {
      idioma: idiomaPorDefecto,
      confianza: "baja",
      motivo:
        "la reseña no tiene señales reconocibles de español ni de inglés; se usa el idioma por defecto de la ficha.",
    };
  }

  // Para que la decisión sea fiable, exigimos que un idioma gane por al
  // menos una señal y que no haya empate exacto. Si empatan a cero ya
  // volvimos arriba; si empatan con señales, no es concluyente y usamos
  // el idioma por defecto.
  if (puntosEs > puntosEn) {
    return { idioma: "es", confianza: "alta", motivo: null };
  }
  if (puntosEn > puntosEs) {
    return { idioma: "en", confianza: "alta", motivo: null };
  }
  return {
    idioma: idiomaPorDefecto,
    confianza: "baja",
    motivo:
      "la reseña tiene señales iguales de español e inglés; se usa el idioma por defecto de la ficha.",
  };
}

/**
 * Rompe el texto en tokens alfabéticos en minúscula. Ignora números,
 * puntuación y espacios. Lo usamos solo para contar señales: no necesita
 * ser perfecto, solo estable y barato.
 */
function limpiarTokens(texto: string): string[] {
  const out: string[] = [];
  let buffer = "";
  for (const ch of texto) {
    if ((ch >= "a" && ch <= "z") || ch === "ñ" || ch === "á" || ch === "é" ||
        ch === "í" || ch === "ó" || ch === "ú") {
      buffer += ch;
    } else {
      if (buffer.length > 0) {
        out.push(buffer);
        buffer = "";
      }
    }
  }
  if (buffer.length > 0) out.push(buffer);
  return out;
}