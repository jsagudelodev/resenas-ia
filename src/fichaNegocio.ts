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

/**
 * RS.11 — Una sucursal del negocio, si la ficha cubre más de una.
 *
 * Cada sucursal firma sus respuestas con su propio `nombre`. Por eso, si la
 * ficha lleva `sucursal`, el `nombre` general se queda como el nombre de la
 * cadena y `sucursal.nombre` es el que aparece en el prompt del redactor
 * (punto 1 del cierre). Si no hay sucursal, el comportamiento es el de
 * antes: `nombre` se usa directamente (punto 2 del cierre).
 *
 * `direccion` y `encargado` son opcionales a propósito: una sucursal puede
 * existir sin encargado visible o sin dirección pública. Pero el `nombre`
 * es obligatorio cuando la sección está presente: sin él, la firma no se
 * puede armar y se rechaza la ficha.
 */
export interface Sucursal {
  /** Nombre con el que la sucursal firma sus respuestas. */
  nombre: string;
  /** Dirección pública de la sucursal. */
  direccion?: string;
  /** Persona que firma o se hace cargo de las respuestas en esa sucursal. */
  encargado?: string;
}

export interface FichaNegocio {
  nombre: string;
  actividad: string;
  tono: Tono;
  contacto: Contacto;
  ofrece: LoQueOfrece;
  noOfrece: LoQueNoOfrece;
  /**
   * RS.11 — Datos de la sucursal. Si están, la respuesta se firma con
   * `sucursal.nombre` y los datos de la sucursal viajan al prompt y al
   * revisor. Si no están, `nombre` se sigue usando como firma: las fichas
   * sin sucursal (anteriores a RS.11) siguen funcionando idénticas.
   */
  sucursal?: Sucursal;
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

  // RS.11 — Sucursal (opcional). Si está presente, se valida igual que el
  // contacto: tiene que ser objeto, y los campos texto tienen que ser texto.
  // El `nombre` de la sucursal es obligatorio cuando la sección existe: sin
  // él no se puede firmar la respuesta y la ficha se rechaza.
  let sucursal: Sucursal | undefined;
  const sucursalCruda = obj["sucursal"];
  if (sucursalCruda !== undefined) {
    if (sucursalCruda === null || typeof sucursalCruda !== "object") {
      return {
        ok: false,
        motivo: "el campo 'sucursal' debe ser un objeto.",
      };
    }
    const s = sucursalCruda as Record<string, unknown>;
    const nombreCrudo = s["nombre"];
    if (typeof nombreCrudo !== "string" || nombreCrudo.trim().length === 0) {
      return {
        ok: false,
        motivo:
          "el campo 'sucursal.nombre' es obligatorio cuando la sección 'sucursal' está presente.",
      };
    }
    const suc: Sucursal = { nombre: nombreCrudo.trim() };
    const direccion = s["direccion"];
    if (direccion !== undefined) {
      if (typeof direccion !== "string") {
        return {
          ok: false,
          motivo: "el campo 'sucursal.direccion' debe ser texto.",
        };
      }
      suc.direccion = direccion.trim();
    }
    const encargado = s["encargado"];
    if (encargado !== undefined) {
      if (typeof encargado !== "string") {
        return {
          ok: false,
          motivo: "el campo 'sucursal.encargado' debe ser texto.",
        };
      }
      suc.encargado = encargado.trim();
    }
    sucursal = suc;
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
  // RS.11: `exactOptionalPropertyTypes` no permite asignar `undefined` a un
  // campo opcional: si la ficha no trae sucursal, la propiedad no se
  // declara. Si la trae, se cuelga como un campo más.
  if (sucursal !== undefined) {
    ficha.sucursal = sucursal;
  }

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