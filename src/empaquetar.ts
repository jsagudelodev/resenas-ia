// RS.12 — El paquete, listo para entregar.
//
// Convierte el resultado de `procesarLote` en lo que se le manda al dueño:
// un archivo Markdown para leer y un CSV para abrir en Excel. Dos reglas de
// diseño, ambas del cierre:
//
// - El CSV se escribe con separador `;` y BOM UTF-8, que es lo que espera un
//   Excel en español (punto 3). Con coma, Excel interpreta «5;3» como un solo
//   campo y el acento se le convierte en mojibake.
// - Las reseñas marcadas para revisión humana y las que fallaron salen en
//   bloques separados del de las listas (punto 2): en Markdown van bajo su
//   propio encabezado y en CSV viajan con la columna `estado`, de modo que el
//   dueño pueda filtrarlas sin leerse todo el lote.
//
// `parsearCSV` es la lectura inversa de `exportarCSV` y se usa en los tests
// para demostrar que los valores coinciden exactamente (punto 1). No tiene
// nada que ver con el parser de entrada de RS.1: aquel lee reseñas de Google
// que un tercero pegó; este lee el paquete que este módulo escribió.

import type { ReseñaNegocio } from "./convertirReseñas.js";
import type { Idioma } from "./detectorIdioma.js";
import type { ResultadoProcesamientoLote } from "./procesarLote.js";

/** En qué cajón del paquete acaba cada reseña. */
export type EstadoEnPaquete = "lista" | "paraRevision" | "fallida";

/** Una fila del paquete: la reseña y lo que se le respondió. */
export interface FilaPaquete {
  /** Posición de la reseña dentro del lote (mismo orden que entró, RS.8). */
  indice: number;
  autor: string;
  estrellas: number | null;
  fecha: string | null;
  /** Texto de la reseña, tal cual llegó. */
  textoResena: string;
  estado: EstadoEnPaquete;
  /**
   * Respuesta lista o borrador para revisar. Vacío en las fallidas: no hay
   * nada que pegar.
   */
  respuesta: string;
  /** Motivo legible de la marca (revisión o fallo). Vacío si está lista. */
  motivo: string;
  idioma: Idioma;
  /** Cuántos intentos de inyección se detectaron en esta reseña (RS.5). */
  intentosDeInyeccion: number;
}

/** Cabecera del CSV, en el mismo orden que devolvemos al parsear. */
export const CABECERA_CSV: ReadonlyArray<string> = [
  "indice",
  "autor",
  "estrellas",
  "fecha",
  "texto_resena",
  "estado",
  "respuesta",
  "motivo",
  "idioma",
  "intentos_inyeccion",
];

/** Separador que un Excel en español reconoce sin asistente de importación. */
export const SEPARADOR_CSV = ";";

/** BOM UTF-8: sin él, Excel lee los acentos como otro code page. */
export const BOM_UTF8 = "\uFEFF";

const ESTADOS: ReadonlySet<string> = new Set([
  "lista",
  "paraRevision",
  "fallida",
]);

function esEstadoConocido(valor: string): valor is EstadoEnPaquete {
  return ESTADOS.has(valor);
}

// ─────────────────────────────────────────────────────────────────────────────
// Del resultado del lote a las filas del paquete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construye una fila por reseña, en el orden en que entraron. `lote` ya
 * garantiza un resultado por reseña (RS.8); si las listas no cuadran, la
 * reseña que sobre se registra con sus datos vacíos y estado `fallida`, que
 * es lo conservador: nunca se pierde una reseña de la vista del dueño.
 */
export function filasDelLote(
  lote: ResultadoProcesamientoLote,
  reseñas: ReadonlyArray<ReseñaNegocio>,
): FilaPaquete[] {
  const filas: FilaPaquete[] = [];
  const total = Math.max(lote.resultados.length, reseñas.length);

  for (let i = 0; i < total; i++) {
    const reseña = reseñas[i];
    const resultado = lote.resultados[i];

    if (resultado === undefined) {
      filas.push({
        indice: i,
        autor: reseña?.autor ?? "",
        estrellas: reseña?.estrellas ?? null,
        fecha: reseña?.fecha ?? null,
        textoResena: reseña?.texto ?? "",
        estado: "fallida",
        respuesta: "",
        motivo: "el lote no devolvió resultado para esta reseña.",
        idioma: "es",
        intentosDeInyeccion: 0,
      });
      continue;
    }

    const estado: EstadoEnPaquete =
      "texto" in resultado
        ? "lista"
        : "revisionHumana" in resultado
          ? "paraRevision"
          : "fallida";

    filas.push({
      indice: i,
      autor: reseña?.autor ?? "",
      estrellas: reseña?.estrellas ?? null,
      fecha: reseña?.fecha ?? null,
      textoResena: reseña?.texto ?? "",
      estado,
      respuesta:
        "texto" in resultado
          ? resultado.texto
          : "revisionHumana" in resultado
            ? resultado.borrador
            : "",
      motivo:
        "revisionHumana" in resultado
          ? resultado.motivo
          : "noDisponible" in resultado
            ? resultado.motivo
            : "",
      idioma: resultado.idioma,
      intentosDeInyeccion: resultado.intentoDeInyeccion.length,
    });
  }

  return filas;
}

/** Solo las respuestas listas para pegar (el bloque que sí se publica). */
export function filasListasDelLote(
  lote: ResultadoProcesamientoLote,
  reseñas: ReadonlyArray<ReseñaNegocio>,
): FilaPaquete[] {
  return filasDelLote(lote, reseñas).filter((f) => f.estado === "lista");
}

/** Las tres pilas del paquete, separadas: nunca mezcladas (punto 2). */
export interface PilasDelPaquete {
  listas: FilaPaquete[];
  paraRevision: FilaPaquete[];
  fallidas: FilaPaquete[];
}

export function separarParaRevisionYFallida(
  lote: ResultadoProcesamientoLote,
  reseñas: ReadonlyArray<ReseñaNegocio>,
): PilasDelPaquete {
  const pilas: PilasDelPaquete = { listas: [], paraRevision: [], fallidas: [] };
  for (const fila of filasDelLote(lote, reseñas)) {
    if (fila.estado === "lista") {
      pilas.listas.push(fila);
    } else if (fila.estado === "paraRevision") {
      pilas.paraRevision.push(fila);
    } else {
      pilas.fallidas.push(fila);
    }
  }
  return pilas;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV: escribir y releer con los mismos valores (puntos 1 y 3 del cierre)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escapa un valor para una celda del CSV. Se entrecomilla cuando lleva el
 * separador, comillas, saltos de línea o espacios alrededor (que Excel
 * recortaría y romperían la comparación byte a byte). Las comillas dobles se
 * duplican, que es la convención RFC 4180 que Excel entiende.
 */
function escaparCelda(valor: string): string {
  const necesitaComillas =
    valor.includes(SEPARADOR_CSV) ||
    valor.includes('"') ||
    valor.includes("\n") ||
    valor.includes("\r") ||
    valor !== valor.trim();
  const limpio = valor.replace(/"/g, '""');
  return necesitaComillas ? `"${limpio}"` : limpio;
}

function valorOVacio(valor: string | null): string {
  return valor ?? "";
}

function numeroOVacio(valor: number | null): string {
  return valor === null ? "" : String(valor);
}

/**
 * Devuelve el contenido del CSV, con BOM UTF-8 al principio y una fila por
 * reseña. Las tres pilas van en el mismo archivo pero distinguibles por la
 * columna `estado` (punto 2): filtrar `paraRevision` deja fuera las listas.
 */
export function exportarCSV(filas: ReadonlyArray<FilaPaquete>): string {
  const lineas: string[] = [CABECERA_CSV.join(SEPARADOR_CSV)];

  for (const fila of filas) {
    const celdas: string[] = [
      String(fila.indice),
      escaparCelda(fila.autor),
      escaparCelda(numeroOVacio(fila.estrellas)),
      escaparCelda(valorOVacio(fila.fecha)),
      escaparCelda(fila.textoResena),
      escaparCelda(fila.estado),
      escaparCelda(fila.respuesta),
      escaparCelda(fila.motivo),
      escaparCelda(fila.idioma),
      escaparCelda(String(fila.intentosDeInyeccion)),
    ];
    lineas.push(celdas.join(SEPARADOR_CSV));
  }

  return BOM_UTF8 + lineas.join("\r\n") + "\r\n";
}

/**
 * Divide el contenido en registros y campos, respetando las comillas. Se
 * recorre carácter a carácter en vez de partir por líneas porque un texto de
 * reseña puede llevar saltos de línea dentro de un campo entrecomillado: ese
 * salto NO termina el registro. Un separador dentro del campo tampoco lo
 * parte, y `""` dentro de comillas es una comilla literal.
 */
function leerRegistrosCSV(texto: string): string[][] {
  const registros: string[][] = [];
  let campos: string[] = [];
  let actual = "";
  let dentroDeComillas = false;
  let registroEmpezado = false;

  for (let i = 0; i < texto.length; i++) {
    const caracter = texto[i] ?? "";

    if (dentroDeComillas) {
      if (caracter === '"') {
        if (texto[i + 1] === '"') {
          actual += '"';
          i += 1;
        } else {
          dentroDeComillas = false;
        }
      } else {
        actual += caracter;
      }
      continue;
    }

    if (caracter === '"' && actual === "") {
      dentroDeComillas = true;
      registroEmpezado = true;
      continue;
    }

    if (caracter === SEPARADOR_CSV) {
      campos.push(actual);
      actual = "";
      registroEmpezado = true;
      continue;
    }

    if (caracter === "\n") {
      // Un \r\n ya consumió el \n al procesar el \r, así que aquí solo llegan
      // saltos de línea sueltos: dentro de comillas caen en otra rama.
      campos.push(actual);
      if (!registroEmpezado || campos.some((c) => c !== "")) {
        registros.push(campos);
      }
      campos = [];
      actual = "";
      registroEmpezado = false;
      continue;
    }

    if (caracter === "\r") {
      campos.push(actual);
      if (!registroEmpezado || campos.some((c) => c !== "")) {
        registros.push(campos);
      }
      campos = [];
      actual = "";
      registroEmpezado = false;
      if (texto[i + 1] === "\n") {
        i += 1;
      }
      continue;
    }

    actual += caracter;
    registroEmpezado = true;
  }

  if (actual !== "" || campos.length > 0) {
    campos.push(actual);
    registros.push(campos);
  }

  return registros;
}

/** Un campo vacío vuelve a ser `null` (estrellas y fecha opcionales). */
function textoONulo(valor: string): string | null {
  return valor === "" ? null : valor;
}

function numeroONulo(valor: string): number | null {
  if (valor === "") {
    return null;
  }
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Lee el CSV que escribió `exportarCSV` y devuelve las filas. Es la inversa
 * exacta: `parsearCSV(exportarCSV(filas))` devuelve las mismas filas.
 *
 * No lanza con un CSV raro: si la cabecera no es la nuestra o una fila no
 * tiene las columnas suficientes, devuelve el conjunto con `errores` para
 * que el llamador reporte un motivo comprensible (regla 9). Aquí `errores`
 * va en el tipo de retorno en lugar de una excepción porque el paquete es
 * un artefacto que el cliente puede reenviar malformado.
 */
export interface ResultadoLecturaCSV {
  filas: FilaPaquete[];
  errores: string[];
}

export function parsearCSV(contenido: string): ResultadoLecturaCSV {
  const errores: string[] = [];
  const sinBom = contenido.startsWith(BOM_UTF8)
    ? contenido.slice(BOM_UTF8.length)
    : contenido;
  const registros = leerRegistrosCSV(sinBom);

  if (registros.length === 0) {
    return { filas: [], errores: ["el CSV está vacío."] };
  }

  const cabecera = registros[0] ?? [];
  if (cabecera.join(SEPARADOR_CSV) !== CABECERA_CSV.join(SEPARADOR_CSV)) {
    return {
      filas: [],
      errores: [
        `la cabecera del CSV no es la del paquete (esperadas ${CABECERA_CSV.length} columnas: ${CABECERA_CSV.join(", ")}).`,
      ],
    };
  }

  const filas: FilaPaquete[] = [];
  for (let n = 1; n < registros.length; n++) {
    const campos = registros[n] ?? [];
    if (campos.length !== CABECERA_CSV.length) {
      errores.push(`la fila ${n} tiene ${campos.length} columnas, se esperaban ${CABECERA_CSV.length}.`);
      continue;
    }
    const [indice, autor, estrellas, fecha, textoResena, estado, respuesta, motivo, idioma, intentos] =
      campos.map((campo) => campo ?? "");

    if (estado === undefined || !esEstadoConocido(estado)) {
      errores.push(`la fila ${n} lleva un estado desconocido: «${estado ?? ""}».`);
      continue;
    }
    if (idioma !== "es" && idioma !== "en") {
      errores.push(`la fila ${n} lleva un idioma desconocido: «${idioma ?? ""}».`);
      continue;
    }

    filas.push({
      indice: Number(indice ?? ""),
      autor: autor ?? "",
      estrellas: numeroONulo(estrellas ?? ""),
      fecha: textoONulo(fecha ?? ""),
      textoResena: textoResena ?? "",
      estado,
      respuesta: respuesta ?? "",
      motivo: motivo ?? "",
      idioma,
      intentosDeInyeccion: Number(intentos ?? ""),
    });
  }

  return { filas, errores };
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown: lo que el dueño lee antes de pegar
// ─────────────────────────────────────────────────────────────────────────────

function encabezadoDeEstado(estado: EstadoEnPaquete): string {
  if (estado === "lista") {
    return "Respuestas listas para pegar";
  }
  return estado === "paraRevision"
    ? "Borradores para revisión humana (NO pegar tal cual)"
    : "Reseñas sin respuesta";
}

function bloqueDeResena(fila: FilaPaquete): string {
  const estrellas =
    fila.estrellas === null ? "sin estrellas" : `${fila.estrellas}★`;
  const fecha = fila.fecha ?? "sin fecha";
  const partes: string[] = [
    `### ${fila.indice + 1}. ${fila.autor === "" ? "reseña sin autor" : fila.autor} — ${estrellas}, ${fecha}`,
    "",
    `> ${fila.textoResena.replace(/\n/g, "\n> ")}`,
    "",
  ];
  if (fila.motivo !== "") {
    partes.push(`**Motivo:** ${fila.motivo}`, "");
  }
  if (fila.intentosDeInyeccion > 0) {
    partes.push(
      `**Atención:** la reseña traía ${fila.intentosDeInyeccion} instrucción(es) disfrazada(s); no se obedecieron.`,
      "",
    );
  }
  if (fila.respuesta !== "") {
    partes.push(fila.respuesta, "");
  }
  return partes.join("\n");
}

/**
 * Renderiza el paquete en Markdown: cabecera con los conteos del lote y tres
 * bloques separados —listas, para revisión y fallidas—, de modo que lo que
 * hay que revisar nunca aparezca mezclado con lo que se puede pegar.
 */
export function exportarMarkdown(
  lote: ResultadoProcesamientoLote,
  reseñas: ReadonlyArray<ReseñaNegocio>,
  nombreDelNegocio: string,
): string {
  const pilas = separarParaRevisionYFallida(lote, reseñas);
  const partes: string[] = [
    `# Respuestas para ${nombreDelNegocio}`,
    "",
    `- Reseñas del lote: ${lote.resultados.length}`,
    `- Listas para pegar: ${pilas.listas.length}`,
    `- Para revisión humana: ${pilas.paraRevision.length}`,
    `- Sin respuesta: ${pilas.fallidas.length}`,
    "",
  ];

  const grupos: ReadonlyArray<ReadonlyArray<FilaPaquete>> = [
    pilas.listas,
    pilas.paraRevision,
    pilas.fallidas,
  ];
  const titulos: ReadonlyArray<EstadoEnPaquete> = ["lista", "paraRevision", "fallida"];

  for (let g = 0; g < grupos.length; g++) {
    const grupo = grupos[g] ?? [];
    const titulo = titulos[g] ?? "fallida";
    partes.push(`## ${encabezadoDeEstado(titulo)}`, "");
    if (grupo.length === 0) {
      partes.push("_Ninguna._", "");
      continue;
    }
    for (const fila of grupo) {
      partes.push(bloqueDeResena(fila));
    }
  }

  return partes.join("\n");
}
