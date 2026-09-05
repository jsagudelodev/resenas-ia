// RS.2 — La ficha del negocio.
//
// Una `FichaNegocio` describe al negocio cuyas reseñas se van a responder:
// nombre, actividad, tono, datos de contacto y lo que el negocio puede
// ofrecer (y lo que no). Esta información condiciona lo que el redactor
// puede prometer: si un campo no está en la ficha, el redactor no puede
// afirmarlo (RS.4).
//
// `validarFicha` no llama a ningún modelo: solo normaliza y devuelve, o un
// motivo legible si la ficha es inválida.

/** Tono con el que el negocio quiere responder. Valor cerrado. */
export type Tono = "cercano" | "formal";

/** Qué puede ofrecer el negocio a clientes insatisfechos. */
export interface LoQueOfrece {
  /** Cosas concretas que el negocio está dispuesto a hacer (p. ej. "repetir el plato"). */
  gestos: string[];
}

/** Qué NO puede hacer el negocio bajo ningún concepto. */
export interface LoQueNoOfrece {
  gestos: string[];
}

/** Datos de contacto públicos del negocio. Todos opcionales: la ficha es
 *  incompleta si falta el nombre o la actividad (punto 1 del cierre), pero el
 *  contacto puede ser parcial. */
export interface Contacto {
  telefono?: string;
  correo?: string;
  direccion?: string;
  web?: string;
}

export interface FichaNegocio {
  nombre: string;
  actividad: string;
  tono: Tono;
  contacto: Contacto;
  ofrece: LoQueOfrece;
  noOfrece: LoQueNoOfrece;
  /**
   * Idioma en el que el negocio quiere responder cuando NO se puede
   * detectar el idioma de la reseña (RS.7, punto 3). Si la ficha no lo
   * indica, queda como `"es"`. La detección por reseña manda sobre este
   * valor cuando funciona.
   */
  idiomaPorDefecto: "es" | "en";
}

export interface FichaValida {
  ok: true;
  ficha: FichaNegocio;
  /** Campos importantes que faltan. Lista vacía = ficha completa. */
  faltantes: string[];
}

export interface FichaInvalida {
  ok: false;
  motivo: string;
}

export type ResultadoValidacionFicha = FichaValida | FichaInvalida;

const TONOS_CONOCIDOS: ReadonlySet<Tono> = new Set<Tono>(["cercano", "formal"]);

function esTonoConocido(valor: string): valor is Tono {
  // La comparación es exhaustiva: si `valor` está en el set, es un Tono.
  return TONOS_CONOCIDOS.has(valor as Tono);
}

/**
 * Normaliza y valida una ficha de negocio entrante.
 *
 * - Acepta fichas incompletas y devuelve la lista de campos importantes que
 *   faltan (punto 1 del cierre).
 * - Rechaza tonos desconocidos con motivo (punto 2 del cierre).
 * - No llama a ningún modelo: solo inspecciona los campos (punto 3 del cierre).
 */
export function validarFicha(entrada: unknown): ResultadoValidacionFicha {
  if (entrada === null || typeof entrada !== "object") {
    return {
      ok: false,
      motivo: "la ficha debe ser un objeto con los datos del negocio.",
    };
  }

  const obj = entrada as Record<string, unknown>;

  // ── Tono (cerrado: motivo si no se reconoce) ─────────────────────────────
  const tonoCrudo = obj["tono"];
  if (typeof tonoCrudo !== "string") {
    return {
      ok: false,
      motivo: "la ficha no indica el tono de respuesta ('cercano' o 'formal').",
    };
  }
  const tonoNormalizado = tonoCrudo.trim().toLowerCase();
  if (!esTonoConocido(tonoNormalizado)) {
    return {
      ok: false,
      motivo: `el tono "${tonoCrudo}" no es válido; use "cercano" o "formal".`,
    };
  }
  const tono: Tono = tonoNormalizado;

  // ── Nombre y actividad: si faltan, la ficha se acepta incompleta ───────
  const nombreCrudo = obj["nombre"];
  const nombre =
    typeof nombreCrudo === "string" ? nombreCrudo.trim() : "";
  const actividadCruda = obj["actividad"];
  const actividad =
    typeof actividadCruda === "string" ? actividadCruda.trim() : "";

  const faltantes: string[] = [];
  if (nombre.length === 0) {
    faltantes.push("nombre");
  }
  if (actividad.length === 0) {
    faltantes.push("actividad");
  }

  // ── Contacto (todos los campos opcionales, pero si la sección existe debe
  //    ser un objeto) ─────────────────────────────────────────────────────
  const contactoCrudo = obj["contacto"];
  let contacto: Contacto = {};
  if (contactoCrudo !== undefined) {
    if (contactoCrudo === null || typeof contactoCrudo !== "object") {
      return {
        ok: false,
        motivo: "el campo 'contacto' debe ser un objeto.",
      };
    }
    const c = contactoCrudo as Record<string, unknown>;
    const telefono = c["telefono"];
    if (telefono !== undefined) {
      if (typeof telefono !== "string") {
        return {
          ok: false,
          motivo: "el campo 'contacto.telefono' debe ser texto.",
        };
      }
      contacto.telefono = telefono.trim();
    }
    const correo = c["correo"];
    if (correo !== undefined) {
      if (typeof correo !== "string") {
        return {
          ok: false,
          motivo: "el campo 'contacto.correo' debe ser texto.",
        };
      }
      contacto.correo = correo.trim();
    }
    const direccion = c["direccion"];
    if (direccion !== undefined) {
      if (typeof direccion !== "string") {
        return {
          ok: false,
          motivo: "el campo 'contacto.direccion' debe ser texto.",
        };
      }
      contacto.direccion = direccion.trim();
    }
    const web = c["web"];
    if (web !== undefined) {
      if (typeof web !== "string") {
        return {
          ok: false,
          motivo: "el campo 'contacto.web' debe ser texto.",
        };
      }
      contacto.web = web.trim();
    }
  }

  // ── Lo que ofrece y no ofrece ───────────────────────────────────────────
  const ofrece = leerLista(obj["ofrece"], "ofrece");
  if (typeof ofrece === "string") {
    return { ok: false, motivo: ofrece };
  }
  const noOfrece = leerLista(obj["noOfrece"], "noOfrece");
  if (typeof noOfrece === "string") {
    return { ok: false, motivo: noOfrece };
  }

  // RS.7: idioma por defecto de la ficha. Si no viene, "es". Si viene pero
  // no es un idioma conocido, se rechaza la ficha (mismo criterio que el
  // tono: valor cerrado).
  const idiomaPorDefectoCrudo = obj["idiomaPorDefecto"];
  let idiomaPorDefecto: "es" | "en" = "es";
  if (idiomaPorDefectoCrudo !== undefined) {
    if (typeof idiomaPorDefectoCrudo !== "string") {
      return {
        ok: false,
        motivo: "el campo 'idiomaPorDefecto' debe ser texto ('es' o 'en').",
      };
    }
    const normalizado = idiomaPorDefectoCrudo.trim().toLowerCase();
    if (normalizado !== "es" && normalizado !== "en") {
      return {
        ok: false,
        motivo: `el idioma por defecto "${idiomaPorDefectoCrudo}" no es válido; use "es" o "en".`,
      };
    }
    idiomaPorDefecto = normalizado;
  }

  const ficha: FichaNegocio = {
    nombre,
    actividad,
    tono,
    contacto,
    ofrece,
    noOfrece,
    idiomaPorDefecto,
  };

  return { ok: true, ficha, faltantes };
}

function leerLista(
  crudo: unknown,
  campo: string
): { gestos: string[] } | string {
  if (crudo === undefined) {
    return { gestos: [] };
  }
  if (crudo === null || typeof crudo !== "object") {
    return `el campo '${campo}' debe ser un objeto con 'gestos'.`;
  }
  const obj = crudo as Record<string, unknown>;
  const gestosCrudos = obj["gestos"];
  if (gestosCrudos === undefined) {
    return { gestos: [] };
  }
  if (!Array.isArray(gestosCrudos)) {
    return `el campo '${campo}.gestos' debe ser una lista de textos.`;
  }
  const gestos: string[] = [];
  for (const g of gestosCrudos) {
    if (typeof g !== "string") {
      return `todos los elementos de '${campo}.gestos' deben ser texto.`;
    }
    const limpio = g.trim();
    if (limpio.length > 0) {
      gestos.push(limpio);
    }
  }
  return { gestos };
}