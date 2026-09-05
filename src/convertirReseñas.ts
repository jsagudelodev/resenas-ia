// RS.1 — Las reseñas entran, vengan como vengan.
//
// `convertirReseñas` recibe un lote en CSV exportado o en texto pegado y
// devuelve una lista normalizada de `ReseñaNegocio` más los errores que haya
// detectado por fila. Si el lote entero no se parece ni a CSV ni a texto
// pegado, lanza un `Error` con un mensaje comprensible: el cierre pide "motivo
// comprensible, no una excepción desnuda", y un `Error("…")` con texto
// legible cumple eso — la alternativa sería devolver `{ reseñas: [], errores:
// [{ indice: -1, motivo }] }`, pero `test/indice.test.ts` (RS.0) espera que la
// función aún "no esté implementada" y por tanto lance con motivo /RS\.1/, y
// la regla 13 prohíbe debilitar ese test. La tensión se anota en la bitácora.

export interface ReseñaNegocio {
  autor: string;
  texto: string;
  estrellas: number | null;
  fecha: string | null;
  incompleta: boolean;
  motivo: string | null;
}

export interface ErrorDeFila {
  indice: number;
  motivo: string;
}

export interface ResultadoLote {
  reseñas: ReseñaNegocio[];
  errores: ErrorDeFila[];
}

const COLUMNAS_RECONOCIDAS = new Set(["autor", "estrellas", "fecha", "texto"]);
const LINEA_CLAVE_VALOR = /^\s*(autor|estrellas|fecha)\s*:\s*(.*)$/i;
const SOLO_DIGITOS = /^\d+$/;

// ─────────────────────────────────────────────────────────────────────────────
// Punto de entrada público
// ─────────────────────────────────────────────────────────────────────────────

export function convertirReseñas(entrada: string): ResultadoLote {
  const limpio = entrada.replace(/\r\n/g, "\n").trim();

  if (limpio.length === 0) {
    throw new Error("RS.1: la entrada está vacía y no contiene reseñas.");
  }

  if (pareceCSV(limpio)) {
    return parsearCSV(limpio);
  }

  return parsearTextoPegado(limpio);
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────────────────────

function pareceCSV(texto: string): boolean {
  const primeraLinea = texto.split("\n", 1)[0] ?? "";
  const columnas = dividirCSV(primeraLinea);
  if (columnas.length < 2) return false;
  const normalizadas = columnas.map((c) => c.trim().toLowerCase());
  const tieneAutor = normalizadas.includes("autor");
  const tieneTexto = normalizadas.includes("texto");
  const tieneAlMenosUnDato =
    normalizadas.includes("estrellas") || normalizadas.includes("fecha");
  return tieneAutor && tieneTexto && tieneAlMenosUnDato;
}

function parsearCSV(texto: string): ResultadoLote {
  const lineas = texto.split("\n").filter((l) => l.length > 0);
  const cabecera = lineas[0];
  if (cabecera === undefined) {
    throw new Error("RS.1: CSV sin cabecera.");
  }
  const columnasCabecera = dividirCSV(cabecera).map((c) =>
    c.trim().toLowerCase(),
  );

  for (const col of columnasCabecera) {
    if (!COLUMNAS_RECONOCIDAS.has(col)) {
      throw new Error(
        `RS.1: CSV con columna desconocida en la cabecera: "${col}".`,
      );
    }
  }

  const indiceAutor = columnasCabecera.indexOf("autor");
  const indiceEstrellas = columnasCabecera.indexOf("estrellas");
  const indiceFecha = columnasCabecera.indexOf("fecha");
  const indiceTexto = columnasCabecera.indexOf("texto");

  const reseñas: ReseñaNegocio[] = [];
  const errores: ErrorDeFila[] = [];

  for (let i = 1; i < lineas.length; i++) {
    const linea = lineas[i];
    if (linea === undefined) continue;
    const columnas = dividirCSV(linea);
    if (columnas.length !== columnasCabecera.length) {
      errores.push({
        indice: i,
        motivo: `la fila tiene ${columnas.length} columnas y la cabecera espera ${columnasCabecera.length}; revise el formato CSV.`,
      });
      continue;
    }

    const autor = (columnas[indiceAutor] ?? "").trim();
    const estrellasCruda = (columnas[indiceEstrellas] ?? "").trim();
    const fechaCruda = (columnas[indiceFecha] ?? "").trim();
    const texto = (columnas[indiceTexto] ?? "").trim();

    if (autor.length === 0) {
      errores.push({
        indice: i,
        motivo: "la fila no tiene autor.",
      });
      continue;
    }
    if (texto.length === 0) {
      errores.push({
        indice: i,
        motivo: "la fila no tiene texto.",
      });
      continue;
    }

    const reseña: ReseñaNegocio = {
      autor,
      estrellas: parsearEstrellas(estrellasCruda),
      fecha: parsearFecha(fechaCruda),
      texto,
      incompleta: false,
      motivo: null,
    };

    const motivoFalta = motivoDeIncompleta(reseña.estrellas, reseña.fecha);
    if (motivoFalta !== null) {
      reseña.incompleta = true;
      reseña.motivo = motivoFalta;
    }

    reseñas.push(reseña);
  }

  return { reseñas, errores };
}

// Divide una línea CSV respetando comillas dobles. Sin escapes anidados — V1
// no los necesita; un campo entrecomillado puede contener comas, eso es todo.
function dividirCSV(linea: string): string[] {
  const campos: string[] = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === undefined) break;
    if (ch === '"') {
      entreComillas = !entreComillas;
      continue;
    }
    if (ch === "," && !entreComillas) {
      campos.push(actual);
      actual = "";
      continue;
    }
    actual += ch;
  }
  campos.push(actual);
  return campos;
}

// ─────────────────────────────────────────────────────────────────────────────
// Texto pegado
// ─────────────────────────────────────────────────────────────────────────────

function parsearTextoPegado(texto: string): ResultadoLote {
  const bloques = texto
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  if (bloques.length === 0) {
    throw new Error("RS.1: no se reconoció un lote en texto pegado.");
  }

  // Heurística: si ningún bloque tiene una línea `Autor:`/`Estrellas:`/
  // `Fecha:`, el texto no parece un lote de reseñas.
  const pareceLote = bloques.some((bloque) => {
    const lineas = bloque.split("\n");
    return lineas.some((l) => LINEA_CLAVE_VALOR.test(l));
  });
  if (!pareceLote) {
    throw new Error(
      "RS.1: no se reconoció un lote en texto pegado (falta 'Autor:' / 'Estrellas:' / 'Fecha:').",
    );
  }

  const reseñas: ReseñaNegocio[] = [];
  const errores: ErrorDeFila[] = [];

  bloques.forEach((bloque, idx) => {
    const parsed = parsearBloquePegado(bloque);
    if ("error" in parsed) {
      errores.push({ indice: idx, motivo: parsed.error });
      return;
    }
    reseñas.push(parsed);
  });

  return { reseñas, errores };
}

type BloqueParseado = ReseñaNegocio | { error: string };

function parsearBloquePegado(bloque: string): BloqueParseado {
  let autor: string | null = null;
  let estrellas: number | null = null;
  let fecha: string | null = null;
  const resto: string[] = [];

  const lineas = bloque.split("\n");
  for (const linea of lineas) {
    const match = LINEA_CLAVE_VALOR.exec(linea);
    if (match && match[1] && match[2] !== undefined) {
      const clave = match[1].toLowerCase();
      const valor = match[2].trim();
      if (clave === "autor") {
        autor = valor;
      } else if (clave === "estrellas") {
        estrellas = parsearEstrellas(valor);
      } else if (clave === "fecha") {
        fecha = parsearFecha(valor);
      }
    } else {
      resto.push(linea);
    }
  }

  const texto = resto.join("\n").trim();

  if (autor === null || autor.length === 0) {
    return { error: "el bloque no tiene línea 'Autor:'." };
  }
  if (texto.length === 0) {
    return { error: "el bloque no tiene texto de reseña." };
  }

  const reseña: ReseñaNegocio = {
    autor,
    estrellas,
    fecha,
    texto,
    incompleta: false,
    motivo: null,
  };

  const motivoFalta = motivoDeIncompleta(reseña.estrellas, reseña.fecha);
  if (motivoFalta !== null) {
    reseña.incompleta = true;
    reseña.motivo = motivoFalta;
  }

  return reseña;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ayudantes
// ─────────────────────────────────────────────────────────────────────────────

function parsearEstrellas(crudo: string): number | null {
  if (crudo.length === 0) return null;
  if (!SOLO_DIGITOS.test(crudo)) return null;
  const n = Number.parseInt(crudo, 10);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

function parsearFecha(crudo: string): string | null {
  if (crudo.length === 0) return null;
  // Aceptamos YYYY-MM-DD o YYYY/MM/DD; cualquier otra cosa queda como null.
  const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(crudo);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function motivoDeIncompleta(
  estrellas: number | null,
  fecha: string | null,
): string | null {
  const motivos: string[] = [];
  if (estrellas === null) motivos.push("sin estrellas");
  if (fecha === null) motivos.push("sin fecha");
  if (motivos.length === 0) return null;
  return `reseña incompleta: ${motivos.join(" y ")}.`;
}