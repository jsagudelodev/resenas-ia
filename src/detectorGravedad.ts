// RS.6 — Lo que hay que mirar antes de publicar.
//
// Una acusación grave —intoxicación, cobro indebido, trato discriminatorio,
// amenaza legal— no se contesta sola: el dueño la tiene que leer antes de
// publicarla. La marca tiene que significar algo: si toda reseña de 1⭐ se
// marca, la marca pierde valor y el dueño deja de mirarla.
//
// `detectarGravedad(texto)` es síncrona, sin modelo, sin red: solo
// expresiones regulares. Si detecta una acusación grave, devuelve el motivo
// legible para que viaje con la reseña (punto 3 del cierre). Si no detecta
// nada, devuelve `null`: el dueño no tiene por qué saber que la función
// existió.
//
// La lista es corta a propósito: mejor un falso negativo que el dueño revise
// a mano, que un falso positivo que tape marcas reales. Lo que esta función
// NO detecta queda en manos de la revisión de RS.4 (datos inventados, etc.)
// y, en el futuro, del propio dueño.

/**
 * Categorías de acusación grave reconocidas. La lista es cerrada: lo que no
 * esté aquí, no se marca automáticamente.
 */
export type CategoriaGravedad =
  /** Sospecha o afirmación de intoxicación alimentaria. */
  | "intoxicacion"
  /** Cobro indebido, doble cargo, cobro de algo no consumido. */
  | "cobroIndebido"
  /** Trato discriminatorio por razón protegida (raza, género, orientación,
   *  religión, discapacidad, origen, etc.). */
  | "discriminacion"
  /** Amenaza o mención explícita de acciones legales / abogados. */
  | "amenazaLegal";

export interface ResultadoGravedad {
  categoria: CategoriaGravedad;
  /** Motivo legible: por qué se marcó, qué debe mirar el dueño. */
  motivo: string;
  /** Fragmento del texto que disparó la regla (≤ 80 chars), con la posición. */
  muestra: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reglas: cada una es una expresión regular case-insensitive. El orden es
// estable: si dos reglas casan, se reportan las dos. La muestra es el
// fragmento más corto que case con la regla, recortado a 80 caracteres.
// ─────────────────────────────────────────────────────────────────────────────

interface ReglaGravedad {
  categoria: CategoriaGravedad;
  patron: RegExp;
  motivo: string;
}

const REGLAS_GRAVEDAD: ReadonlyArray<ReglaGravedad> = [
  // Intoxicación: «me intoxicaron», «intoxicación alimentaria», «acabé en el
  // hospital», «la comida estaba en mal estado». Se acepta la raíz entera
  // (`intoxic…`) porque la acusación llega conjugada de muchas formas.
  {
    categoria: "intoxicacion",
    patron:
      /\b(intoxic\w*|envenen\w*|comida\s+en\s+mal\s+estado|echada\s+a\s+perder|acab\w*\s+en\s+el\s+hospital|fui\s+al\s+hospital|me\s+sent[ií]\s+mal\s+despu[eé]s\s+de\s+(?:comer|cenar|almorzar))\b/i,
    motivo:
      "la reseña alega una posible intoxicación; hay que verificarla antes de responder.",
  },
  // Cobro indebido: «me cobraron dos veces», «doble cargo», «me cobraron de
  // más», «cobro no autorizado».
  {
    categoria: "cobroIndebido",
    patron:
      /\b((?:me|nos)\s+cobraron\s+(?:dos\s+veces|otra\s+vez|doble|de\s+m[áa]s|por\s+error|lo\s+que\s+no)|doble\s+(?:cargo|cobro)|cobro\s+(?:indebido|no\s+autorizado|no\s+justificado)|cobraron\s+(?:sin\s+mi\s+autorizaci[óo]n|de\s+m[áa]s))\b/i,
    motivo:
      "la reseña alega un cobro indebido; hay que revisar el ticket antes de responder.",
  },
  // Trato discriminatorio: «me discriminaron», «trato discriminatorio», «no me
  // atendieron por ser…», y los insultos por razón protegida (raíz entera).
  {
    categoria: "discriminacion",
    patron:
      /\b(discrimin\w*|racis\w*|hom[óo]fob\w*|transf[óo]b\w*|sexis\w*|machis\w*|xenofob\w*|no\s+(?:me|nos)\s+(?:atendieron|sirvieron|dejaron\s+entrar)\s+por\s+ser)\b/i,
    motivo:
      "la reseña alega un trato discriminatorio; hay que revisarla antes de responder.",
  },
  // Amenaza legal / abogados: «mis abogados», «voy a denunciar», «los
  // demandaré», «acción legal».
  {
    categoria: "amenazaLegal",
    patron:
      /\b(abogad\w*|denunc\w*|demand\w*|demanda\s+colectiva|acci[óo]n\s+legal|juicio\s+contra)\b/i,
    motivo:
      "la reseña menciona acciones legales; hay que revisarla antes de responder.",
  },
];

export function detectarGravedad(texto: string): ReadonlyArray<ResultadoGravedad> {
  const hallazgos: ResultadoGravedad[] = [];
  for (const regla of REGLAS_GRAVEDAD) {
    const m = regla.patron.exec(texto);
    if (m === null) continue;
    const inicio = m.index;
    const coincidencia = m[0];
    const muestra = recortar(coincidencia, 80);
    hallazgos.push({
      categoria: regla.categoria,
      motivo: regla.motivo,
      muestra: `${muestra} (pos. ${inicio})`,
    });
  }
  return hallazgos;
}

function recortar(s: string, max: number): string {
  const limpio = s.replace(/\s+/g, " ").trim();
  if (limpio.length <= max) return limpio;
  return `${limpio.slice(0, max - 1)}…`;
}