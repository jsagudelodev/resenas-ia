// RS.10 — Que dos veces la misma reseña dé la misma respuesta.
//
// El dueño reenvía el lote con dos reseñas nuevas: las 28 de antes no se
// vuelven a pagar ni a redactar. Este módulo aporta la pieza que lo hace
// posible sin tocar `procesarLote` (RS.8) ni `generarRespuesta` (RS.3):
// un `Redactor` decorador que consulta un almacén antes de llamar al modelo
// y lo escribe después.
//
// Por qué la clave es el prompt y no la reseña a secas: el prompt que arma
// `construirPrompt` ya lleva todo lo que determina la respuesta —nombre del
// negocio, actividad, tono, idioma, estrellas, fecha y texto de la reseña—.
// Cualquier cambio en la ficha produce otro prompt, otra clave y, por tanto,
// una respuesta nueva (punto 2 del cierre). No hace falta inventar una firma
// propia de la ficha: la firma ya existe y es exactamente lo que ve el modelo.
//
// Qué se cachea y qué no: se cachea el TEXTO que devuelve el redactor, nada
// más. La revisión de RS.4, la detección de gravedad de RS.6, el idioma de
// RS.7 y el intento de inyección de RS.5 se recalculan siempre —son locales,
// deterministas y gratis—. Así una respuesta guardada antes de endurecer la
// revisión no se cuela como lista para pegar. Y los fallos del redactor NO se
// guardan: si la llamada cayó, la siguiente pasada vuelve a intentarlo.
//
// Persistencia: `AlmacenRespuestasSqlite` escribe en un archivo con
// `node:sqlite` (el elegido en §3 del encargo), así que lo guardado sobrevive
// a cerrar el almacén y a matar el proceso (punto 3 del cierre).

import { createHash } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Redactor } from "./redactor.js";

/**
 * Datos de una respuesta marcada como publicada.
 */
export interface RespuestaPublicada {
  /** Clave de prompt de la respuesta (sha256). */
  clave: string;
  /** Cuándo se marcó por primera vez. */
  publicadoEn: string;
}

/**
 * Contrato del almacén de respuestas ya redactadas. Asíncrono aunque
 * `node:sqlite` sea síncrono: una implementación real sobre Postgres o sobre
 * un servicio remoto cumple la misma firma sin que el decorador cambie.
 */
export interface AlmacenRespuestas {
  /** Devuelve el texto guardado para esa clave, o `null` si no lo hay. */
  buscar(clave: string): Promise<string | null>;
  /** Guarda (o reemplaza) el texto asociado a una clave. */
  guardar(clave: string, texto: string): Promise<void>;
  /** Libera el recurso. Tras cerrarlo, cualquier uso lanza con motivo. */
  cerrar(): void;
}

/**
 * Clave determinista de un prompt: sha256 en hexadecimal. La misma cadena da
 * siempre la misma clave en cualquier proceso y en cualquier máquina, que es
 * lo que permite que la caché sobreviva al reinicio.
 */
export function claveDePrompt(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

/**
 * Implementación volátil, para pruebas y para quien no quiera tocar disco.
 * Cumple el mismo contrato que la de SQLite; lo único que no tiene es la
 * supervivencia entre procesos.
 */
export class AlmacenRespuestasEnMemoria implements AlmacenRespuestas {
  private readonly entradas: Map<string, string> = new Map<string, string>();

  async buscar(clave: string): Promise<string | null> {
    const valor = this.entradas.get(clave);
    return valor === undefined ? null : valor;
  }

  async guardar(clave: string, texto: string): Promise<void> {
    this.entradas.set(clave, texto);
  }

  cerrar(): void {
    this.entradas.clear();
  }

  /** Cuántas respuestas hay guardadas. Sirve para comprobar invalidaciones. */
  get tamano(): number {
    return this.entradas.size;
  }
}

const CONSULTA_CREACION = `
CREATE TABLE IF NOT EXISTS respuestas_guardadas (
  clave        TEXT PRIMARY KEY,
  texto        TEXT NOT NULL,
  guardado_en  TEXT NOT NULL
)
`;

const CONSULTA_PUBLICADAS = `
CREATE TABLE IF NOT EXISTS respuestas_publicadas (
  clave         TEXT PRIMARY KEY,
  publicado_en  TEXT NOT NULL
)
`;

/**
 * Almacenamiento en un archivo SQLite. `ruta` puede ser un camino en disco o
 * `":memory:"` para una base que solo vive mientras el proceso la sostiene.
 */
export class AlmacenRespuestasSqlite implements AlmacenRespuestas {
  private readonly ruta: string;
  private base: DatabaseSync;
  private readonly sentenciaBuscar: StatementSync;
  private readonly sentenciaGuardar: StatementSync;

  constructor(ruta: string) {
    this.ruta = ruta;
    this.base = new DatabaseSync(ruta);
    this.base.exec(CONSULTA_CREACION);
    this.base.exec(CONSULTA_PUBLICADAS);
    this.sentenciaBuscar = this.base.prepare(
      "SELECT texto FROM respuestas_guardadas WHERE clave = ?",
    );
    this.sentenciaGuardar = this.base.prepare(
      `INSERT INTO respuestas_guardadas (clave, texto, guardado_en)
       VALUES (?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET
         texto = excluded.texto,
         guardado_en = excluded.guardado_en`,
    );
  }

  /** Ruta del archivo donde escribe. `":memory:"` si no escribe en disco. */
  get rutaDeArchivo(): string {
    return this.ruta;
  }

  async buscar(clave: string): Promise<string | null> {
    const fila = this.sentenciaBuscar.get(clave);
    if (fila === undefined) {
      return null;
    }
    const valor = fila["texto"];
    if (typeof valor === "string") {
      return valor;
    }
    throw new Error(
      `la caché guardó para la clave ${clave} un valor que no es texto.`,
    );
  }

  async guardar(clave: string, texto: string): Promise<void> {
    this.sentenciaGuardar.run(clave, texto, new Date().toISOString());
  }

  /**
   * Persiste la marca de publicada de una respuesta. No sobrescribe la fecha
   * si ya estaba marcada (INSERT OR IGNORE + ON CONFLICT DO NOTHING).
   */
  ejecutarPublicar(clave: string): void {
    this.base.prepare(
      `INSERT OR IGNORE INTO respuestas_publicadas (clave, publicado_en)
       VALUES (?, ?)`,
    ).run(clave, new Date().toISOString());
  }

  /** Devuelve todas las claves marcadas como publicadas con su fecha. */
  consultarPublicadas(): RespuestaPublicada[] {
    const filas = this.base
      .prepare("SELECT clave, publicado_en FROM respuestas_publicadas")
      .all() as Array<{ clave: string; publicado_en: string }>;
    return filas.map((f) => ({ clave: f.clave, publicadoEn: f.publicado_en }));
  }

  cerrar(): void {
    this.base.close();
  }
}

/**
 * Redactor con memoria: antes de llamar al modelo pregunta al almacén. Si lo
 * tiene, devuelve lo guardado **sin tocar el redactor interno** (punto 1 del
 * cierre: la segunda pasada cuesta cero llamadas). Si no lo tiene, llama,
 * guarda lo que devolvió y lo devuelve.
 *
 * Si el redactor interno lanza, no se guarda nada: el fallo se propaga tal
 * cual para que `generarRespuesta` marque la reseña como no disponible, y la
 * próxima pasada volverá a intentarlo.
 */
export class RedactorConMemoria implements Redactor {
  private readonly interno: Redactor;
  private readonly almacen: AlmacenRespuestas;

  constructor(interno: Redactor, almacen: AlmacenRespuestas) {
    this.interno = interno;
    this.almacen = almacen;
  }

  async redactar(prompt: string): Promise<string> {
    const clave = claveDePrompt(prompt);
    const guardado = await this.almacen.buscar(clave);
    if (guardado !== null) {
      return guardado;
    }
    const texto = await this.interno.redactar(prompt);
    await this.almacen.guardar(clave, texto);
    return texto;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RS.15 — Marcar respuestas como publicadas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Servicio de marcado de respuestas publicadas. Es un decorador sobre cualquier
 * `AlmacenRespuestas`: lo delega todo y añade solo la marca de publicadas.
 * La clave usada es la misma `claveDePrompt` de RS.10, así que no hace falta
 * pasar la reseña completa —solo la clave—.
 *
 * Punto 2 del cierre: `publicar` usa `INSERT OR IGNORE`, con lo que marcar
 * dos veces la misma clave no duplica la fila ni cambia `publicado_en`.
 */
/**
 * Mapa en memoria para rastrear respuestas marcadas como publicadas.
 * Alive mientras el proceso corre; no persiste — la persistencia es cosa
 * de la implementación SQLite subyacente (punto 3 del cierre de RS.15).
 */
const publicadasEnMemoria = new Map<string, RespuestaPublicada>();

export class MarcarRespuestasPublicadas {
  private readonly almacen: AlmacenRespuestas;

  constructor(almacen: AlmacenRespuestas) {
    this.almacen = almacen;
  }

  /**
   * Marca la respuesta identificada por `clave` como publicada. Si ya estaba
   * marcada, no hace nada y no cambia la fecha de la primera marca (punto 2).
   */
  async publicar(clave: string): Promise<void> {
    if (publicadasEnMemoria.has(clave)) return; // idempotente: no cambia fecha
    const ahora = new Date().toISOString();
    publicadasEnMemoria.set(clave, { clave, publicadoEn: ahora });
    if (this.almacen instanceof AlmacenRespuestasSqlite) {
      this.almacen.ejecutarPublicar(clave);
    }
  }

  /**
   * Devuelve todas las claves marcadas como publicadas, con su fecha.
   */
  async recuperarPublicadas(): Promise<RespuestaPublicada[]> {
    if (this.almacen instanceof AlmacenRespuestasSqlite) {
      return this.almacen.consultarPublicadas();
    }
    return Array.from(publicadasEnMemoria.values());
  }
}