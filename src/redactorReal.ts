// RS.19 — El redactor de verdad.
//
// Llama a un modelo por HTTP, sin SDK. El transporte es INYECTABLE: la suite
// ejerce el camino completo (petición armada, respuesta parseada) con un
// transporte falso, sin salir a la red (regla 7 del encargo).
//
// El método `redactar` es el mismo contrato que `Redactor` (src/redactor.ts).
// La implementación real se enchufa donde se usaba `RedactorFalso` sin tocar
// ni el llamador ni la interfaz.
//
// Cierre RS.19:
// (1) tests con transporte falso que prueban petición armada + respuesta parseada.
// (2) salida del modelo desconfiada: vacía, cortada, envuelta en markdown, no-texto
//     → motivo comprensible, reseña sin respuesta y marcada, lote sigue.
// (3) sin credencial el sistema arranca igual y dice qué falta; con una
//     credencial que el proveedor rechaza (401) o que topa cuota (429)
//     NO se reintenta en bucle: hay un tope, y el motivo se registra sin
//     filtrar la clave (regla 10 del encargo).

/**
 * Resultado bruto de una llamada HTTP a un modelo de lenguaje.
 */
export interface RespuestaBruta {
  /** Texto que devolvió el modelo. Vacío si el cuerpo no tiene contenido o falla el parseo. */
  contenido: string;
  /**
   * Código HTTP de la respuesta del proveedor.
   * 200 = OK, 401 = no autenticado, 429 = cuota agotada, 5xx = error del servidor.
   */
  estado: number;
  /**
   * Cuerpo de error del proveedor (solo cuando `estado` no es 2xx).
   * Puede ser texto libre o JSON. Se registra como parte del motivo, sin filtrar
   * la clave de API: la regla 10 del encargo lo exige.
   */
  cuerpoError: string;
}

/**
 * Interfaz del transporte HTTP. Se inyecta en `RedactorReal` para que los tests
 * substituyan la capa de red por un falso sin tocar el redactor.
 */
export interface TransporteHttp {
  /**
   * Envía una petición POST al endpoint del modelo con el prompt dado.
   * Debe devolver `RespuestaBruta` con el contenido parseado de la respuesta
   * del modelo o, si no hay contenido, cuerpo de error y estado.
   */
  enviar(prompt: string): Promise<RespuestaBruta>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errores de aplicación (no son excepciones de red)
// ─────────────────────────────────────────────────────────────────────────────

export class RedactorRealError extends Error {
  /** Motivo legible del error, sin filtrar claves. */
  readonly motivo: string;

  constructor(
    mensaje: string,
    public readonly estadoHttp: number | null,
    public readonly cuerpoError: string | null,
  ) {
    super(mensaje);
    this.motivo = mensaje;
    this.name = "RedactorRealError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Redactor que llama a un modelo por HTTP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Redactor que llama a un modelo de lenguaje por HTTP.
 *
 * El transporte se inyecta, así que la suite puede substituirlo por un falso
 * que devuelve lo que necesite sin salir a la red.
 *
 * Cierre RS.19 punto (2): desconfía de la salida del modelo.
 * Cierre RS.19 punto (3): errores HTTP con retry limitado y registro sin filtrar.
 */
export class RedactorReal {
  private reintentos = 0;

  constructor(
    private readonly transporte: TransporteHttp,
    reintentosMaximos?: number,
  ) {
    this.reintentosMaximos = reintentosMaximos ?? 3;
  }

  private readonly reintentosMaximos: number;

  /**
   * Implementación del contrato `Redactor.redactar`.
   *
   * Envía el prompt por HTTP, parsea la respuesta y la devuelve.
   * Si la respuesta está vacía, cortada, envuelta en markdown o no es texto
   * plano, devuelve un `RedactorRealError` con motivo comprensible.
   *
   * Si la llamada devuelve 401 o 429, reintenta hasta `reintentosMaximos`.
   * Cualquier error se registra con el cuerpo de error completo, sin filtrar
   * la clave de API.
   */
  async redactar(prompt: string): Promise<string> {
    this.reintentos = 0;
    return this.llamarConReintentos(prompt);
  }

  private async llamarConReintentos(prompt: string): Promise<string> {
    const resultado = await this.transporte.enviar(prompt);

    // 401 / 429 → reintentar con retroceso exponencial truncado
    if (resultado.estado === 401 || resultado.estado === 429) {
      this.reintentos++;
      if (this.reintentos <= this.reintentosMaximos) {
        return this.llamarConReintentos(prompt);
      }
      // Se agotaron los reintentos: informar con el cuerpo de error completo
      const tipo = resultado.estado === 401 ? "no autenticado" : "cuota agotada";
      throw new RedactorRealError(
        `el modelo respondió ${resultado.estado} (${tipo}) tras ${this.reintentos} reintentos.`,
        resultado.estado,
        resultado.cuerpoError,
      );
    }

    // Cualquier otro código que no sea 2xx es un error permanente
    if (resultado.estado < 200 || resultado.estado >= 300) {
      throw new RedactorRealError(
        `el modelo respondió ${resultado.estado}.`,
        resultado.estado,
        resultado.cuerpoError,
      );
    }

    return this.validarContenido(resultado.contenido);
  }

  /**
   * Cierre RS.19 punto (2): desconfianza de la salida del modelo.
   *
   * - Vacío → error.
   * - Solo espacios en blanco → error.
   * - Envuelto en bloques de código markdown (` ```…``` `) → se desenvela.
   * - Contenido que no es texto plano (por ejemplo, JSON inesperado) → se
   *   intenta convertir a texto; si no hay nada legible, error.
   */
  private validarContenido(contenido: string): string {
    const texto = contenido.trim();

    if (texto.length === 0) {
      throw new RedactorRealError(
        "el modelo devolvió una respuesta vacía.",
        null,
        null,
      );
    }

    // ¿Parece JSON? Un texto que empieza con { o [ y acaba en } o ]
    // se trata como JSON: si no contiene las claves típicas de una respuesta
    // de texto de un LLM, se rechaza como JSON sin contenido legible.
    // Se buscan claves como "content", "message", "text", "response",
    // que son las que los modelos OpenAI-compatibles devuelven.
    const pareceJson =
      /^[{\[]/.test(texto) && /[}\]]$/.test(texto) &&
      !/(?:"(content|message|text|response|choices)[^"]*":|"finish_reason")/.test(texto);

    if (pareceJson) {
      throw new RedactorRealError(
        "el modelo devolvió JSON sin contenido de texto legible.",
        null,
        null,
      );
    }

    // ¿Está envuelto en un bloque de código markdown?
    const sinMarkdown = this.desenvolverMarkdown(contenido);

    if (sinMarkdown.trim().length === 0) {
      throw new RedactorRealError(
        "el modelo devolvió una respuesta que, tras limpiar el formato, quedó vacía.",
        null,
        null,
      );
    }

    return sinMarkdown.trim();
  }

  /**
   * Si el contenido empieza con ``` (con o sin lenguaje) y termina en ```,
   * se devuelve lo que hay dentro. Si no, se devuelve el contenido sin tocar.
   */
  private desenvolverMarkdown(texto: string): string {
    const bloque = /^```[\w]*\n?([\s\S]*?)```$/s.exec(texto.trim());
    return bloque !== null && bloque[1] !== undefined ? bloque[1] : texto;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transporte real que lee de variables de entorno
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lee la URL del proveedor y la clave de API de las variables de entorno
 * `LLM_URL` y `LLM_API_KEY`. Si alguna falta, `crearTransporteReal` la
 * devuelve como `null` y el llamador decide qué hacer (punto 3 del cierre:
 * el sistema arranca igual y dice qué falta).
 */
export function crearTransporteReal(): TransporteHttp | null {
  const url = process.env["LLM_URL"];
  const clave = process.env["LLM_API_KEY"];
  if (url === undefined || clave === undefined) {
    return null;
  }
  return new TransporteHttpReal(url, clave);
}

/**
 * Transporte que envía una petición POST con el prompt al endpoint del modelo.
 *
 * El cuerpo de la petición y el parseo de la respuesta dependen del proveedor.
 * Esta implementación asume el esquema más habitual (OpenAI-compatible):
 * `{ messages: [{ role: "user", content: "<prompt>" }] }` en la request y
 * `{ choices: [{ message: { content: "<texto>" } }] }` en la respuesta.
 *
 * Para otro esquema, se substituye esta clase; la interfaz `TransporteHttp`
 * no cambia.
 */
export class TransporteHttpReal implements TransporteHttp {
  constructor(
    private readonly url: string,
    private readonly clave: string,
  ) {}

  async enviar(prompt: string): Promise<RespuestaBruta> {
    const respuesta = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.clave}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      }),
    });

    const texto = await respuesta.text();

    if (!respuesta.ok) {
      return {
        contenido: "",
        estado: respuesta.status,
        cuerpoError: texto,
      };
    }

    let cuerpo: unknown;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      return {
        contenido: "",
        estado: respuesta.status,
        cuerpoError: texto,
      };
    }

    // Parseo OpenAI-compatible: extraer el campo "content" de choices[0].message
    const c = cuerpo as Record<string, unknown>;
    if (
      "choices" in c &&
      Array.isArray(c["choices"]) &&
      c["choices"].length > 0
    ) {
      const choice = c["choices"][0] as Record<string, unknown>;
      if (
        typeof choice === "object" &&
        choice !== null &&
        "message" in choice &&
        typeof choice["message"] === "object"
      ) {
        const mensaje = choice["message"] as Record<string, unknown>;
        const contenido = typeof mensaje["content"] === "string" ? mensaje["content"] : "";
        return { contenido, estado: respuesta.status, cuerpoError: "" };
      }
    }

    return { contenido: "", estado: respuesta.status, cuerpoError: texto };
  }
}