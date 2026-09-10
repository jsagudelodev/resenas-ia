// Importador de reseñas — automatiza el cuello de botella manual de copiar y
// pegar reseñas de Google que hoy hace `docs/la-venta.md` §6 ("la entrada es
// manual... para diez clientes va bien, para cien no existe").
//
// Mismo patrón que `redactorReal.ts` para el LLM: el transporte que habla con
// el proveedor es INYECTABLE, así que la suite ejerce el camino completo
// (dedup, persistencia, errores) sin salir a la red.
//
// Por qué un proveedor de scraping de pago y no la API oficial de Google ni
// scraping directo a Google Maps:
//   - La API oficial (Place Details) solo devuelve 5 reseñas "más relevantes"
//     por lugar: no alcanza para lotes de 10-30.
//   - La Google Business Profile API exige que el propio dueño autorice por
//     OAuth su cuenta — viable a futuro, pero es una fricción de venta que
//     no tiene sentido antes de la primera venta validada.
//   - Scraping directo a Google Maps arriesga el negocio del cliente (bloqueo
//     de IP, ToS) justo cuando el objetivo es escalar a MÁS clientes, es
//     decir, más visibilidad del riesgo.
//   Un proveedor de scraping de pago (Outscraper, SerpApi...) asume ese
//   riesgo por contrato y da un JSON estable; el transporte es sustituible
//   por diseño si cambia el proveedor.

import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ReseñaNegocio } from "./convertirReseñas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

/** Una reseña tal como la devuelve el proveedor de importación, sin normalizar. */
export interface ReseñaImportada {
  /** Identificador único y estable que da el proveedor para esta reseña. */
  idExterno: string;
  autor: string;
  texto: string;
  estrellas: number | null;
  /** Fecha en formato ISO `YYYY-MM-DD`, o `null` si el proveedor no la da. */
  fecha: string | null;
}

/**
 * Transporte que habla con el proveedor de importación. Se inyecta en
 * `ImportadorReseñas` para que los tests sustituyan la capa de red por una
 * falsa, igual que `TransporteHttp` en `redactorReal.ts`.
 */
export interface TransporteImportacion {
  /** Devuelve las reseñas visibles hoy para el `placeId` dado. */
  obtenerReseñas(placeId: string): Promise<ReseñaImportada[]>;
}

/**
 * Error de la importación con motivo comprensible. Nunca deja pasar una
 * excepción cruda: quien la use puede registrar `motivo` sin filtrar la
 * clave del proveedor (regla de saneamiento del proyecto, ver `registro.ts`).
 */
export class ImportadorError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ImportadorError";
  }
}

/** Contrato del almacén que recuerda qué reseñas ya se importaron por negocio. */
export interface AlmacenImportacion {
  /** Ids externos ya vistos para ese `placeId`. */
  vistos(placeId: string): Promise<Set<string>>;
  /** Marca estos ids como vistos para ese `placeId`. Idempotente. */
  marcarVistos(placeId: string, ids: string[]): Promise<void>;
  cerrar(): void;
}

export interface ResultadoImportacion {
  /** Solo las reseñas nuevas, ya en el formato que consume `procesarLote`. */
  reseñas: ReseñaNegocio[];
  /** Cuántas devolvió el proveedor en total (nuevas + ya vistas). */
  totalRecibidas: number;
  nuevas: number;
  yaVistas: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Almacén de deduplicación
// ─────────────────────────────────────────────────────────────────────────────

/** Implementación volátil, para pruebas y para quien no quiera tocar disco. */
export class AlmacenImportacionEnMemoria implements AlmacenImportacion {
  private readonly vistosPorNegocio = new Map<string, Set<string>>();

  async vistos(placeId: string): Promise<Set<string>> {
    return new Set(this.vistosPorNegocio.get(placeId) ?? []);
  }

  async marcarVistos(placeId: string, ids: string[]): Promise<void> {
    const actual = this.vistosPorNegocio.get(placeId) ?? new Set<string>();
    for (const id of ids) actual.add(id);
    this.vistosPorNegocio.set(placeId, actual);
  }

  cerrar(): void {
    this.vistosPorNegocio.clear();
  }
}

const CONSULTA_CREACION = `
CREATE TABLE IF NOT EXISTS reseñas_importadas (
  place_id     TEXT NOT NULL,
  id_externo   TEXT NOT NULL,
  importado_en TEXT NOT NULL,
  PRIMARY KEY (place_id, id_externo)
)
`;

/**
 * Persistencia en SQLite: lo importado sobrevive a reiniciar el proceso, así
 * que reenviar el mismo negocio dos días seguidos no vuelve a traer (ni a
 * cobrar) las reseñas ya entregadas.
 */
export class AlmacenImportacionSqlite implements AlmacenImportacion {
  private readonly base: DatabaseSync;
  private readonly sentenciaVistos: StatementSync;
  private readonly sentenciaMarcar: StatementSync;

  constructor(ruta: string) {
    this.base = new DatabaseSync(ruta);
    this.base.exec(CONSULTA_CREACION);
    this.sentenciaVistos = this.base.prepare(
      "SELECT id_externo FROM reseñas_importadas WHERE place_id = ?",
    );
    this.sentenciaMarcar = this.base.prepare(
      `INSERT OR IGNORE INTO reseñas_importadas (place_id, id_externo, importado_en)
       VALUES (?, ?, ?)`,
    );
  }

  async vistos(placeId: string): Promise<Set<string>> {
    const filas = this.sentenciaVistos.all(placeId) as { id_externo: string }[];
    return new Set(filas.map((f) => f.id_externo));
  }

  async marcarVistos(placeId: string, ids: string[]): Promise<void> {
    const ahora = new Date().toISOString();
    for (const id of ids) {
      this.sentenciaMarcar.run(placeId, id, ahora);
    }
  }

  cerrar(): void {
    this.base.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Importador
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trae las reseñas nuevas de un negocio y las deja listas para `procesarLote`.
 *
 * "Nuevas" se decide por `idExterno` contra el almacén, no por fecha: un
 * proveedor puede reordenar o no dar fecha, y el id que él mismo asigna es lo
 * único estable entre dos llamadas.
 *
 * Un fallo del transporte (red caída, proveedor rechaza la clave, cuota
 * agotada) nunca se propaga como excepción cruda: se convierte en
 * `ImportadorError` con motivo legible, para que quien la use pueda
 * registrarla y decirle al operador qué pasó sin tumbar el servicio.
 */
export class ImportadorReseñas {
  constructor(
    private readonly transporte: TransporteImportacion,
    private readonly almacen: AlmacenImportacion,
  ) {}

  async importarNuevas(placeId: string): Promise<ResultadoImportacion> {
    let brutas: ReseñaImportada[];
    try {
      brutas = await this.transporte.obtenerReseñas(placeId);
    } catch (error: unknown) {
      const motivo = error instanceof Error ? error.message : String(error);
      throw new ImportadorError(
        `no se pudieron obtener las reseñas del negocio: ${motivo}`,
      );
    }

    const vistos = await this.almacen.vistos(placeId);
    const nuevas = brutas.filter((r) => !vistos.has(r.idExterno));
    if (nuevas.length > 0) {
      await this.almacen.marcarVistos(placeId, nuevas.map((r) => r.idExterno));
    }

    return {
      reseñas: nuevas.map(aReseñaNegocio),
      totalRecibidas: brutas.length,
      nuevas: nuevas.length,
      yaVistas: brutas.length - nuevas.length,
    };
  }
}

function aReseñaNegocio(r: ReseñaImportada): ReseñaNegocio {
  const motivos: string[] = [];
  if (r.estrellas === null) motivos.push("sin estrellas");
  if (r.fecha === null) motivos.push("sin fecha");
  const incompleta = motivos.length > 0;
  return {
    autor: r.autor,
    texto: r.texto,
    estrellas: r.estrellas,
    fecha: r.fecha,
    incompleta,
    motivo: incompleta ? `reseña incompleta: ${motivos.join(" y ")}.` : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Transporte real, configurado por entorno (mismo patrón que crearTransporteReal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lee `IMPORTADOR_URL` y `IMPORTADOR_API_KEY` del entorno. Si falta alguna,
 * devuelve `null` y el llamador decide qué hacer: el sistema arranca igual y
 * dice qué falta, en vez de fallar en silencio.
 */
export function crearTransporteImportacionReal(): TransporteImportacion | null {
  const url = process.env["IMPORTADOR_URL"];
  const clave = process.env["IMPORTADOR_API_KEY"];
  if (url === undefined || clave === undefined) {
    return null;
  }
  return new TransporteImportacionReal(url, clave);
}

/**
 * Transporte HTTP hacia un proveedor de scraping de reseñas de Google Maps.
 *
 * Formato asumido (el habitual en proveedores tipo Outscraper): GET a
 * `<url>?query=<placeId>` con la clave en la cabecera, y una respuesta
 * `{ reviews: [{ review_id, author_name, review_text, review_rating,
 * review_datetime_utc }] }`. Si el proveedor usa otro esquema, se sustituye
 * esta clase; la interfaz `TransporteImportacion` no cambia (mismo principio
 * que `TransporteHttpReal` para el LLM).
 */
export class TransporteImportacionReal implements TransporteImportacion {
  constructor(
    private readonly url: string,
    private readonly clave: string,
  ) {}

  async obtenerReseñas(placeId: string): Promise<ReseñaImportada[]> {
    const destino = new URL(this.url);
    destino.searchParams.set("query", placeId);

    const respuesta = await fetch(destino, {
      method: "GET",
      headers: { "X-API-KEY": this.clave },
    });

    const texto = await respuesta.text();

    if (!respuesta.ok) {
      throw new Error(
        `el proveedor de importación respondió ${respuesta.status}: ${texto}`,
      );
    }

    let cuerpo: unknown;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      throw new Error(
        "el proveedor de importación devolvió una respuesta que no es JSON.",
      );
    }

    return interpretarRespuestaProveedor(cuerpo);
  }
}

function interpretarRespuestaProveedor(cuerpo: unknown): ReseñaImportada[] {
  if (cuerpo === null || typeof cuerpo !== "object" || !("reviews" in cuerpo)) {
    return [];
  }
  const bruto = (cuerpo as Record<string, unknown>)["reviews"];
  if (!Array.isArray(bruto)) return [];

  const reseñas: ReseñaImportada[] = [];
  for (const fila of bruto) {
    if (fila === null || typeof fila !== "object") continue;
    const f = fila as Record<string, unknown>;
    const idExterno = leerTexto(f["review_id"]);
    const autor = leerTexto(f["author_name"]);
    const texto = leerTexto(f["review_text"]);
    if (idExterno === null || autor === null || texto === null) continue;
    reseñas.push({
      idExterno,
      autor,
      texto,
      estrellas: leerEstrellas(f["review_rating"]),
      fecha: leerFecha(f["review_datetime_utc"]),
    });
  }
  return reseñas;
}

function leerTexto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  return limpio.length > 0 ? limpio : null;
}

function leerEstrellas(valor: unknown): number | null {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return Math.round(n);
}

function leerFecha(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.trim().length === 0) return null;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return null;
  const parte = fecha.toISOString().slice(0, 10);
  return parte;
}
