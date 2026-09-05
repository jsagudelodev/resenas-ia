// RS.3 — La respuesta redactada.
//
// El redactor es una INTERFAZ sustituible: la suite corre con el
// `RedactorFalso`, sin red ni credenciales (punto 2 del cierre). Una
// implementación real (SDK de un proveedor de IA) cumple la misma interfaz y
// se enchufa sin tocar el resto del código.
//
// El método es asíncrono porque una llamada real a un modelo lo es; el falso
// también devuelve una promesa para que el código de llamada no distinga.

/**
 * Interfaz pública de cualquier redactor que pueda producir una respuesta a
 * una reseña. Una implementación falsa cumple el contrato sin hablar con
 * ningún modelo externo.
 */
export interface Redactor {
  /**
   * Recibe un prompt con la reseña y la ficha del negocio ya formateadas, y
   * devuelve la respuesta lista para pegar. Si no puede producirla, lanza:
   * `generarRespuesta` se encarga de capturar el fallo y marcar la reseña.
   */
  redactar(prompt: string): Promise<string>;
}

/**
 * Redactor de pruebas: NO habla con ningún modelo externo. Decide qué
 * contestar mirando el prompt: si contiene el nombre del negocio y un
 * marcador de estrellas, devuelve un texto que los menciona y refleja el
 * sentimiento del marcador. Sirve para cerrar RS.3 sin red ni credenciales.
 *
 * Si el prompt no contiene un nombre ni estrellas reconocibles, lanza —
 * simulando el caso "el LLM no está disponible" del cierre de RS.3.
 */
export class RedactorFalso implements Redactor {
  async redactar(prompt: string): Promise<string> {
    const nombre = extraerNombreDelNegocio(prompt);
    const estrellas = extraerEstrellas(prompt);
    // RS.7: el idioma viene ya decidido en el prompt. Si el prompt no lo
    // trae, asumimos español (compatibilidad con prompts antiguos).
    const idioma = extraerIdiomaDelPrompt(prompt);

    if (nombre === null) {
      throw new Error("prompt sin nombre del negocio");
    }
    if (estrellas === null) {
      throw new Error("prompt sin estrellas de la reseña");
    }

    if (idioma === "en") {
      return redactarEnIngles(nombre, estrellas);
    }
    return redactarEnEspanol(nombre, estrellas);
  }
}

function redactarEnEspanol(nombre: string, estrellas: number): string {
  if (estrellas >= 4) {
    return (
      `Gracias por su reseña, ${nombre}. ` +
      `Nos alegra mucho saber que la experiencia fue positiva. ` +
      `Esperamos volver a atenderle pronto.`
    );
  }
  if (estrellas <= 2) {
    return (
      `Gracias por su reseña, ${nombre}. ` +
      `Lamentamos que la experiencia no haya sido la esperada y ` +
      `tomamos nota para mejorar. ` +
      `Nos gustaría escucharle y resolver lo ocurrido.`
    );
  }
  // 3 estrellas: neutro
  return (
    `Gracias por su reseña, ${nombre}. ` +
    `Tomamos nota de su comentario para seguir mejorando.`
  );
}

function redactarEnIngles(nombre: string, estrellas: number): string {
  if (estrellas >= 4) {
    return (
      `Thank you for your review, ${nombre}. ` +
      `We are very glad to hear the experience was positive. ` +
      `We hope to serve you again soon.`
    );
  }
  if (estrellas <= 2) {
    return (
      `Thank you for your review, ${nombre}. ` +
      `We are sorry the experience was not what you expected and ` +
      `we will take note to improve. ` +
      `We would like to listen to you and resolve what happened.`
    );
  }
  // 3 estrellas: neutro
  return (
    `Thank you for your review, ${nombre}. ` +
    `We take note of your comment to keep improving.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ayudas internas para que el redactor falso "lea" el prompt. No son parte del
// contrato público: el prompt lo construye `generarRespuesta` y ambas piezas
// viven juntas en este paquete.
// ─────────────────────────────────────────────────────────────────────────────

function extraerNombreDelNegocio(prompt: string): string | null {
  const m = /Nombre del negocio:\s*([^\n]+)/i.exec(prompt);
  if (m === null || m[1] === undefined) return null;
  const limpio = m[1].trim();
  return limpio.length > 0 ? limpio : null;
}

function extraerEstrellas(prompt: string): number | null {
  const m = /Estrellas:\s*(\d+)/i.exec(prompt);
  if (m === null || m[1] === undefined) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

/**
 * Lee el idioma decidido por el detector (RS.7). Por defecto, español: si
 * el prompt no incluye la línea, devolvemos "es" para mantener el
 * comportamiento histórico del redactor.
 */
function extraerIdiomaDelPrompt(prompt: string): "es" | "en" {
  const m = /Idioma de la respuesta:\s*([a-zA-Z]+)/i.exec(prompt);
  if (m === null || m[1] === undefined) return "es";
  const v = m[1].trim().toLowerCase();
  if (v === "en") return "en";
  return "es";
}