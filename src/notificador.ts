// RS.28 — Avisar cuando el paquete está listo.
//
// La corrida automática (RS.26) hoy procesa negocios sin que nadie se entere
// de que hay un paquete nuevo: alguien tiene que acordarse de pedirlo. Este
// módulo cierra ese hueco con un aviso — no "publicar la respuesta" (eso
// sigue fuera de alcance, ver ENCARGO.md §2), solo "aquí está el enlace".
//
// Por qué un webhook genérico y no "el SDK de WhatsApp": un POST con JSON a
// una URL configurable es el mínimo común de casi cualquier forma real de
// avisar — Twilio, la Cloud API de WhatsApp, un webhook de Zapier/Make que
// arma el mensaje, o un bot interno — sin acoplar este proyecto a un
// proveedor concreto ni a sus credenciales. Mismo principio que
// `TransporteHttp` (LLM) y `TransporteImportacion` (reseñas): el CONTRATO es
// lo estable; quién responde al otro lado del POST se decide en producción.

/** Lo que se avisa cuando un negocio tiene un paquete nuevo listo. */
export interface AvisoPaquete {
  placeId: string;
  nombreNegocio: string;
  paqueteId: string;
  conteos: { listas: number; paraRevision: number; fallaron: number };
  /** Enlace de un solo uso (RS.18) para descargar el paquete. */
  enlaceUrl: string;
}

/**
 * Envía el aviso. Se inyecta en la corrida automática (RS.26) para que la
 * suite pueda sustituirlo por uno falso, sin salir a la red.
 */
export interface Notificador {
  avisar(aviso: AvisoPaquete): Promise<void>;
}

/** Error del aviso con motivo comprensible. Nunca deja pasar una excepción cruda. */
export class NotificadorError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "NotificadorError";
  }
}

/**
 * Lee `NOTIFICADOR_URL` (obligatoria) y `NOTIFICADOR_API_KEY` (opcional) del
 * entorno. Sin `NOTIFICADOR_URL`, devuelve `null`: el sistema arranca igual
 * y sin avisos, en vez de fallar.
 */
export function crearNotificadorWebhook(): Notificador | null {
  const url = process.env["NOTIFICADOR_URL"];
  if (url === undefined || url.trim().length === 0) {
    return null;
  }
  const clave = process.env["NOTIFICADOR_API_KEY"];
  return new NotificadorWebhook(url, clave);
}

/**
 * `POST` del aviso como JSON al webhook configurado. Un estado no-2xx se
 * convierte en `NotificadorError` con el cuerpo de la respuesta, SIN incluir
 * la clave en el mensaje (regla de saneamiento del proyecto: ninguna
 * credencial viaja a un log ni a un motivo de error legible).
 */
export class NotificadorWebhook implements Notificador {
  constructor(
    private readonly url: string,
    private readonly clave?: string,
  ) {}

  async avisar(aviso: AvisoPaquete): Promise<void> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.clave !== undefined && this.clave.trim().length > 0) {
      headers["Authorization"] = `Bearer ${this.clave}`;
    }

    const respuesta = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(aviso),
    });

    if (!respuesta.ok) {
      const cuerpo = await respuesta.text();
      throw new NotificadorError(
        `el servicio de aviso respondió ${respuesta.status}: ${cuerpo}`,
      );
    }
  }
}
