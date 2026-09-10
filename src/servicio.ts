// RS.14 — Subir el lote y recibir el paquete.
//
// El endpoint que junta todo lo anterior: el dueño manda su lote y su ficha,
// recibe el resumen y un identificador para descargar el paquete.
//
// Cierre:
//
//   (1) `POST` con el lote y la ficha devuelve el resumen y un identificador
//       para descargar el paquete.
//   (2) Un lote vacío o corrupto devuelve un motivo comprensible y **no
//       tumba el servicio**.
//   (3) El número máximo de reseñas por lote se configura.
//
// Por qué `node:http` y no Fastify (la elección de §3): para RS.14 no hace
// falta un framework —el cierre habla de dos rutas y un parseo de JSON— y
// `node:http` corre sin dependencias y sin red saliente. Los tests usan
// `127.0.0.1` con puerto efímero (`127.0.0.1:0`): el listener se abre en
// loopback, no se publica nada en internet. Si en una tanda futura hace
// falta middleware (autenticación, rate-limit, CORS…), se enchufa Fastify
// y este módulo expone la misma forma: `crearServidor` y `cerrar`.
//
// Diseño del servidor:
//
//   - `crearServidor(opciones?)` arma y deja LISTO el `http.Server` en
//     `127.0.0.1` con puerto efímero, pero NO lo expone todavía. Devuelve
//     `{ puerto, url, cerrar }`.
//   - `iniciarServidor(opciones?)` es el atajo para producción: lo arranca
//     y devuelve `{ puerto, url, cerrar }`.
//   - El servidor devuelve siempre JSON salvo el endpoint de descarga, que
//     devuelve el CSV con la codificación adecuada para Excel en español
//     (BOM UTF-8 + `;`, que es lo que arma `exportarCSV` de RS.12).
//   - El parseo de la entrada distingue cuatro modos de fallo legibles
//     (punto 2): ficha inválida, ficha con cuerpo ausente, lote ausente o
//     vacío, lote corrupto (no se parece a nada). Cada uno devuelve 400 con
//     `{ motivo: string }`. **El servidor sigue escuchando** después de
//     responder: lo valida el test del cierre.
//
// Límite configurable (punto 3): el máximo de reseñas por lote se toma de
// `opciones.maxReseñasPorLote`, o de la variable de entorno
// `MAX_RESEÑAS_POR_LOTE`, o del valor por defecto. El cliente puede enviarlo
// también en el body, pero el servidor lo RECHAZA si supera el límite
// configurado.

import http, {
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { randomBytes, randomUUID } from "node:crypto";

import { convertirReseñas, type ReseñaNegocio } from "./convertirReseñas.js";
import { validarFicha, type FichaNegocio } from "./fichaNegocio.js";
import { RedactorFalso, type Redactor } from "./redactor.js";
import { procesarLote, type ResultadoProcesamientoLote } from "./procesarLote.js";
import { resumirQuejas, type ResumenDeQuejas } from "./resumirQuejas.js";
import {
  exportarCSV,
  exportarMarkdown,
  filasDelLote,
  type FilaPaquete,
} from "./empaquetar.js";
import {
  ImportadorError,
  type ImportadorReseñas,
} from "./importadorReseñas.js";
import {
  ProgramadorImportacion,
  type NegocioProgramado,
  type ResultadoCicloNegocio,
} from "./programadorImportacion.js";
import type { CatalogoNegocios } from "./catalogoNegocios.js";
import type { Notificador } from "./notificador.js";

// ─────────────────────────────────────────────────────────────────────────────
// Configuración pública
// ─────────────────────────────────────────────────────────────────────────────

/** Máximo de reseñas por lote cuando nadie dice otra cosa. */
export const MAX_RESEÑAS_POR_LOTE_DEFECTO = 100;

/** Plazo de caducidad de los enlaces cuando nadie dice otra cosa: 7 días. */
export const PLAZO_CADUCIDAD_DEFECTO_MS = 7 * 24 * 60 * 60 * 1000;

export interface OpcionesServidor {
  /** Tope de reseñas por lote. Default: `MAX_RESEÑAS_POR_LOTE_DEFECTO`. */
  maxReseñasPorLote?: number;
  /** Redactor a inyectar en el procesador del lote. Default: `new RedactorFalso()`. */
  redactor?: Redactor;
  /**
   * Host al que se ata el listener. Default: `"127.0.0.1"`. El servicio NUNCA
   * escucha en `0.0.0.0` por defecto: la decisión de exponerlo es del
   * operador. Cambiarlo es responsabilidad de quien despliega.
   */
  host?: string;
  /**
   * Puerto del listener. `0` deja al sistema asignar uno libre. Default: `0`.
   */
  puerto?: number;
  /**
   * Plazo de caducidad de los enlaces en milisegundos. Default: `604800000`
   * (7 días). Si es `0` o negativo, los enlaces nunca caducan.
   */
  plazoCaducidadEnMs?: number;
  /**
   * Importador de reseñas para `POST /lotes/importar`. Si no se pasa, esa
   * ruta responde 501 con un motivo comprensible: importar automáticamente
   * es una capacidad opcional, no un requisito para levantar el servidor.
   */
  importador?: ImportadorReseñas;
  /**
   * RS.26 — seguimiento automático: si se pasa, `crearServidor` arma un
   * `ProgramadorImportacion` (reutilizando `importador`) y lo arranca de
   * inmediato con este intervalo. Requiere `importador` configurado; sin él
   * se ignora (no tiene de dónde traer reseñas). El programador queda
   * expuesto en `ServidorLevantado.programador` para registrar o quitar
   * negocios sobre la marcha, y `cerrar()` lo detiene.
   */
  programadorImportacion?: {
    intervaloMs: number;
    /** Negocios bajo seguimiento desde el arranque. Se pueden sumar más después con `programador.registrarNegocio`. */
    negocios?: NegocioProgramado[];
    /** Hueco para el aviso al dueño (RS.28) o para logging del operador. */
    alTerminarCiclo?: (resultados: ResultadoCicloNegocio[]) => void;
    /**
     * RS.27 — catálogo persistente. Si se pasa, el programador recarga los
     * negocios guardados al arrancar (`cargarDesdeCatalogo`, ANTES de sumar
     * `negocios`) y cada alta/baja posterior queda persistida: reiniciar el
     * proceso con el mismo catálogo recupera el seguimiento sin tener que
     * repetir `negocios` en las opciones.
     */
    catalogo?: CatalogoNegocios;
    /**
     * RS.28 — si se pasa, tras cada ciclo automático se avisa (vía
     * `Notificador.avisar`) por cada negocio que produjo un paquete nuevo,
     * con un enlace de descarga (RS.18) recién generado. Un fallo del aviso
     * se registra en stderr y no interrumpe nada más: avisar es best-effort,
     * el paquete ya quedó guardado y sigue disponible por las rutas de
     * siempre aunque el aviso falle.
     */
    notificador?: Notificador;
  };
}

/**
 * Lee el límite de la variable de entorno. Solo acepta enteros positivos; si
 * el valor no es válido, devuelve el default. La variable es la forma que
 * tiene el operador de subir el tope sin recompilar.
 */
function limiteDesdeEntorno(): number {
  const crudo = process.env["MAX_RESEÑAS_POR_LOTE"];
  if (crudo === undefined || crudo.trim().length === 0) {
    return MAX_RESEÑAS_POR_LOTE_DEFECTO;
  }
  const numero = Number(crudo);
  if (!Number.isInteger(numero) || numero < 1) {
    return MAX_RESEÑAS_POR_LOTE_DEFECTO;
  }
  return numero;
}

function limiteEfectivo(opciones: OpcionesServidor | undefined): number {
  if (opciones?.maxReseñasPorLote !== undefined) {
    const n = opciones.maxReseñasPorLote;
    if (Number.isInteger(n) && n >= 1) return n;
  }
  return limiteDesdeEntorno();
}

// ─────────────────────────────────────────────────────────────────────────────
// Almacén de paquetes generados
// ─────────────────────────────────────────────────────────────────────────────

/** Paquete generado por un `POST /lotes`, listo para descargar. */
export interface PaqueteAlmacenado {
  /** CSV completo, con BOM UTF-8 y separador `;`. */
  csv: string;
  /** Markdown paralelo al CSV. */
  markdown: string;
  /** Filas del paquete (la estructura que arma `filasDelLote`). */
  filas: FilaPaquete[];
  /** Ficha con la que se procesó el lote (por si el cliente la pide). */
  ficha: FichaNegocio;
}

/** Enlace generado para un paquete. */
export interface EnlaceGenerado {
  token: string;
  idLote: string;
  /** Marcas de cuando se creó y de cuándo caduca. */
  creadoMs: number;
  caducaMs: number;
}

export interface AlmacenDeLotes {
  guardar(id: string, paquete: PaqueteAlmacenado): void;
  /** Devuelve el paquete o `null` si el id no existe. */
  obtener(id: string): PaqueteAlmacenado | null;
  /**
   * Genera y almacena un enlace para el paquete `idLote`. Devuelve el
   * `EnlaceGenerado` con el token. El plazo de caducidad se pasa aquí
   * para que el almacén no necesite conocer las opciones del servidor.
   */
  generarEnlace(idLote: string, plazoMs: number): EnlaceGenerado;
  /**
   * Consume un token de enlace: si es válido y no ha caducado, devuelve el
   * paquete y lo invalida. Si no existe, está caducado o ya se canjeó,
   * devuelve `null`. Nunca revela cuál de esas tres razones aplica.
   */
  canjearEnlace(token: string): PaqueteAlmacenado | null;
  cerrar(): void;
}

/**
 * Almacén en memoria de los paquetes generados. Cumple el contrato
 * `AlmacenDeLotes`. Un despliegue real apuntaría aquí a Redis o a SQLite:
 * el servicio HTTP no tendría que cambiar, solo el constructor.
 */
export class AlmacenDeLotesEnMemoria implements AlmacenDeLotes {
  private readonly paquetes: Map<string, PaqueteAlmacenado> = new Map();
  private readonly enlaces: Map<string, EnlaceGenerado> = new Map();

  guardar(id: string, paquete: PaqueteAlmacenado): void {
    this.paquetes.set(id, paquete);
  }

  obtener(id: string): PaqueteAlmacenado | null {
    const v = this.paquetes.get(id);
    return v === undefined ? null : v;
  }

  generarEnlace(idLote: string, plazoMs: number): EnlaceGenerado {
    const token = randomBytes(32).toString("hex");
    const ahoraMs = Date.now();
    const enlace: EnlaceGenerado = {
      token,
      idLote,
      creadoMs: ahoraMs,
      caducaMs: ahoraMs + plazoMs,
    };
    this.enlaces.set(token, enlace);
    return enlace;
  }

  canjearEnlace(token: string): PaqueteAlmacenado | null {
    const enlace = this.enlaces.get(token);
    if (enlace === undefined) return null;
    if (Date.now() > enlace.caducaMs) return null;
    this.enlaces.delete(token);
    const paquete = this.paquetes.get(enlace.idLote);
    return paquete ?? null;
  }

  cerrar(): void {
    this.paquetes.clear();
    this.enlaces.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cuerpo de la petición
// ─────────────────────────────────────────────────────────────────────────────

/** Body aceptado por `POST /lotes`. */
export interface EntradaProcesarLote {
  /** Ficha del negocio (RS.2). */
  ficha: unknown;
  /**
   * Lote en CSV exportado o en texto pegado (RS.1). También se acepta un
   * array de reseñas ya normalizadas si el cliente lo prefiere, pero el
   * cierre habla de "subir el lote" así que la entrada canónica es texto.
   */
  lote: unknown;
  /** Tope de reseñas del lote concreto (opcional). Lo RECHAZA si lo supera. */
  maxReseñas?: unknown;
}

export interface SalidaProcesarLote {
  /** Identificador para descargar el paquete en `GET /lotes/:id/paquete`. */
  id: string;
  /** Conteo que devuelve `procesarLote` (RS.8). */
  conteos: { listas: number; paraRevision: number; fallaron: number };
  /** Resumen de quejas del lote (RS.9). */
  resumen: ResumenDeQuejas;
  /** Aviso de fichas incompletas, si los hay (RS.2). */
  fichaFaltantes: string[];
}

/** Body aceptado por `POST /lotes/importar`. */
export interface EntradaImportarLote {
  /** Identificador del negocio para el proveedor de importación configurado. */
  placeId: unknown;
  /** Ficha del negocio (RS.2). */
  ficha: unknown;
  maxReseñas?: unknown;
}

export interface SalidaImportarLote {
  /**
   * Identificador para descargar el paquete, o `null` si no había reseñas
   * nuevas que empaquetar (nada que entregar, no es un error).
   */
  id: string | null;
  /** Cuántas trajo el proveedor en total y cuántas eran nuevas. */
  totalRecibidas: number;
  nuevas: number;
  yaVistas: number;
  conteos: { listas: number; paraRevision: number; fallaron: number };
  resumen: ResumenDeQuejas;
  fichaFaltantes: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Servidor HTTP
// ─────────────────────────────────────────────────────────────────────────────

export interface ServidorLevantado {
  /** Puerto asignado (útil cuando se pidió `0`). */
  puerto: number;
  /** URL completa con el puerto real, ya con `127.0.0.1`. */
  url: string;
  /** Cierra el listener y vacía el almacén. Tras cerrar, cualquier petición
   *  falla. El test lo usa para limpiar entre casos. */
  cerrar(): Promise<void>;
  /**
   * Presente solo si se pasó `opciones.programadorImportacion`. Permite
   * registrar o quitar negocios del seguimiento automático (RS.26) sin
   * reiniciar el servidor.
   */
  programador?: ProgramadorImportacion;
}

const ENCABEZADOS_CSV: ReadonlyArray<[string, string]> = [
  ["Content-Type", "text/csv; charset=utf-8"],
  ["Content-Disposition", 'attachment; filename="paquete.csv"'],
];

/**
 * Construye y ARRANCA un servidor HTTP en loopback. Devuelve el puerto real
 * (cuando se pidió `0`) y una función para cerrarlo. Es la pieza que el
 * operador del servicio usa en producción y la que los tests invocan para
 * hablarle con `fetch`.
 */
export async function crearServidor(
  opciones: OpcionesServidor | undefined,
  almacen: AlmacenDeLotes,
): Promise<ServidorLevantado> {
  const maxReseñasPorLote = limiteEfectivo(opciones);
  const redactor: Redactor = opciones?.redactor ?? new RedactorFalso();
  const host = opciones?.host ?? "127.0.0.1";
  const puerto = opciones?.puerto ?? 0;
  const plazoCaducidadMs =
    opciones?.plazoCaducidadEnMs !== undefined && opciones.plazoCaducidadEnMs > 0
      ? opciones.plazoCaducidadEnMs
      : PLAZO_CADUCIDAD_DEFECTO_MS;
  const importador = opciones?.importador;

  // RS.28: la URL base no se conoce hasta que `server.listen` resuelve (el
  // puerto real, si se pidió `0`). Se guarda en una caja mutable porque el
  // aviso solo se arma cuando el temporizador dispara un ciclo, que siempre
  // ocurre DESPUÉS de que el servidor ya esté escuchando.
  const urlBase = { valor: "" };

  // RS.26: si se pidió seguimiento automático y hay de dónde importar, se
  // arma el programador ANTES de levantar el listener para que quede listo
  // (y arrancado) en cuanto el servidor resuelva.
  let programador: ProgramadorImportacion | undefined;
  if (opciones?.programadorImportacion !== undefined && importador !== undefined) {
    const cfg = opciones.programadorImportacion;
    const notificador = cfg.notificador;

    // RS.28: al terminar cada ciclo automático, avisa por cada negocio que
    // produjo un paquete. Nunca deja escapar el fallo de un aviso: el
    // paquete ya quedó guardado y sigue disponible por las rutas de
    // siempre aunque el webhook de aviso esté caído.
    const alTerminarCiclo = (resultados: ResultadoCicloNegocio[]): void => {
      cfg.alTerminarCiclo?.(resultados);
      if (notificador === undefined) return;
      for (const resultado of resultados) {
        if (resultado.paquete === undefined) continue;
        const enlace = almacen.generarEnlace(resultado.paquete.id, plazoCaducidadMs);
        const ficha = programador
          ?.listarNegocios()
          .find((n) => n.placeId === resultado.placeId)?.ficha;
        void notificador
          .avisar({
            placeId: resultado.placeId,
            nombreNegocio: ficha?.nombre ?? resultado.placeId,
            paqueteId: resultado.paquete.id,
            conteos: resultado.paquete.conteos,
            enlaceUrl: `${urlBase.valor}/enlace/${enlace.token}`,
          })
          .catch((error: unknown) => {
            const mensaje = error instanceof Error ? error.message : String(error);
            process.stderr.write(
              `[servicio] no se pudo avisar del paquete del negocio ${resultado.placeId}: ${mensaje}\n`,
            );
          });
      }
    };

    programador = new ProgramadorImportacion(
      importador,
      async (negocio, reseñas) => {
        const paquete = await empaquetarYGuardar(reseñas, negocio.ficha, { redactor, almacen });
        return { id: paquete.id, conteos: paquete.conteos };
      },
      undefined,
      alTerminarCiclo,
      cfg.catalogo,
    );
    // Primero lo guardado (sobrevive a un reinicio con el mismo catálogo),
    // después la lista explícita de esta llamada: si un `placeId` aparece
    // en ambos, la ficha de `negocios` gana (es la más reciente a ojos de
    // quien arranca el proceso).
    await programador.cargarDesdeCatalogo();
    for (const negocio of cfg.negocios ?? []) {
      await programador.registrarNegocio(negocio);
    }
  }

  return new Promise<ServidorLevantado>((resolver, rechazar) => {
    const server: Server = http.createServer((req, res) => {
      // El handler se define abajo como función flecha para no perder el
      // cierre sobre `almacen` y `redactor`. Cualquier error SIN responder
      // aún cae al 500 sin tumbar el server (punto 2: "no tumba el
      // servicio"). El error se loguea a stderr para no perderlo en silencio.
      void manejarPeticion(req, res, {
        almacen,
        redactor,
        maxReseñasPorLote,
        plazoCaducidadMs,
        importador,
      }).catch((error: unknown) => {
        const mensaje = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[servicio] error no controlado: ${mensaje}\n`);
        if (!res.headersSent) {
          responderJSON(res, 500, { motivo: "error interno del servicio." });
        } else {
          res.end();
        }
      });
    });

    server.once("error", (err: Error) => {
      rechazar(err);
    });

    server.listen(puerto, host, () => {
      const direccion = server.address();
      if (direccion === null || typeof direccion === "string") {
        rechazar(new Error("el servidor no reveló su dirección."));
        return;
      }
      const puertoReal = direccion.port;
      const url = `http://${host}:${puertoReal}`;
      urlBase.valor = url;
      if (programador !== undefined && opciones?.programadorImportacion !== undefined) {
        programador.iniciar(opciones.programadorImportacion.intervaloMs);
      }
      resolver({
        puerto: puertoReal,
        url,
        cerrar: async () => {
          programador?.detener();
          await cerrarServidor(server, almacen);
        },
        ...(programador !== undefined ? { programador } : {}),
      });
    });
  });
}

function cerrarServidor(server: Server, almacen: AlmacenDeLotes): Promise<void> {
  return new Promise<void>((resolver) => {
    server.close(() => {
      almacen.cerrar();
      resolver();
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Manejo de peticiones
// ─────────────────────────────────────────────────────────────────────────────

interface ContextoManejo {
  almacen: AlmacenDeLotes;
  redactor: Redactor;
  maxReseñasPorLote: number;
  plazoCaducidadMs: number;
  importador: ImportadorReseñas | undefined;
}

async function manejarPeticion(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ContextoManejo,
): Promise<void> {
  const url = req.url ?? "/";
  const metodo = req.method ?? "GET";

  if (metodo === "POST" && url === "/lotes") {
    await manejarPOSTLotes(req, res, ctx);
    return;
  }

  if (metodo === "POST" && url === "/lotes/importar") {
    await manejarPOSTLoteImportar(req, res, ctx);
    return;
  }

  if (metodo === "GET" && url.startsWith("/lotes/")) {
    const resto = url.slice("/lotes/".length);
    // /lotes/:id/paquete
    const partes = resto.split("/");
    const id = partes[0] ?? "";
    if (partes.length === 2 && partes[1] === "paquete" && id.length > 0) {
      manejarGETPaquete(req, res, ctx, id);
      return;
    }
    // /lotes/:id/enlace — genera un token para el paquete.
    if (partes.length === 2 && partes[1] === "enlace" && id.length > 0) {
      await manejarGETEnlace(req, res, ctx, id);
      return;
    }
    // /lotes/:id — redirige a la descarga directa del paquete (RS.14).
    if (partes.length === 1 && id.length > 0) {
      manejarGETPaquete(req, res, ctx, id);
      return;
    }
  }

  // GET /enlace/:token — canjea el enlace y devuelve el CSV.
  if (metodo === "GET" && url.startsWith("/enlace/")) {
    const token = url.slice("/enlace/".length);
    await manejarGETEnlaceToken(req, res, ctx, token);
    return;
  }

  if (metodo === "GET" && url === "/salud") {
    responderJSON(res, 200, { ok: true });
    return;
  }

  responderJSON(res, 404, { motivo: "ruta no encontrada." });
}

async function manejarPOSTLotes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ContextoManejo,
): Promise<void> {
  const cuerpo = await leerCuerpo(req).catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    return `__error__:${msg}`;
  });
  if (typeof cuerpo === "string" && cuerpo.startsWith("__error__:")) {
    responderJSON(res, 400, {
      motivo: `no se pudo leer el cuerpo de la petición: ${cuerpo.slice("__error__:".length)}`,
    });
    return;
  }

  let entrada: EntradaProcesarLote;
  try {
    const parsed: unknown = JSON.parse(cuerpo);
    if (!esObjeto(parsed)) {
      responderJSON(res, 400, {
        motivo: "el cuerpo debe ser un objeto JSON con 'ficha' y 'lote'.",
      });
      return;
    }
    entrada = parsed as unknown as EntradaProcesarLote;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    responderJSON(res, 400, {
      motivo: `JSON inválido en el cuerpo de la petición: ${msg}`,
    });
    return;
  }

  if (entrada.ficha === undefined || entrada.ficha === null) {
    responderJSON(res, 400, { motivo: "falta la ficha del negocio." });
    return;
  }

  const validacion = validarFicha(entrada.ficha);
  if (!validacion.ok) {
    responderJSON(res, 400, { motivo: `ficha inválida: ${validacion.motivo}` });
    return;
  }

  if (entrada.lote === undefined || entrada.lote === null) {
    responderJSON(res, 400, { motivo: "falta el lote de reseñas." });
    return;
  }
  if (typeof entrada.lote !== "string") {
    responderJSON(res, 400, {
      motivo: "el lote debe ser texto (CSV o pegado).",
    });
    return;
  }

  let conversion: { reseñas: ReseñaNegocio[]; errores: unknown[] };
  try {
    conversion = convertirReseñas(entrada.lote);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    responderJSON(res, 400, {
      motivo: `el lote no se pudo interpretar: ${msg}`,
    });
    return;
  }

  // El límite se aplica sobre el número de reseñas reconocidas, no sobre
  // las líneas del texto pegado: el dueño no tiene por qué saber que el
  // CSV lleva una cabecera. Y se cuenta ANTES de procesar para que un lote
  // enorme no gaste trabajo en el redactor.
  const maxEfectivo = limiteDePeticion(entrada.maxReseñas, ctx.maxReseñasPorLote);
  if (conversion.reseñas.length > maxEfectivo) {
    responderJSON(res, 400, {
      motivo:
        `el lote tiene ${conversion.reseñas.length} reseñas y el máximo ` +
        `configurado es ${maxEfectivo}. Suba el lote en partes o ajuste el tope.`,
    });
    return;
  }

  if (conversion.reseñas.length === 0) {
    responderJSON(res, 400, {
      motivo:
        "el lote se interpretó pero no contiene ninguna reseña. " +
        "Revise el formato (CSV con cabecera 'autor,estrellas,fecha,texto' " +
        "o texto pegado con bloques separados).",
    });
    return;
  }

  // Aviso al operador: las filas que no se pudieron parsear se devuelven en el
  // log del lote y NO cuentan para el tamaño, pero el lote sigue.
  const paquete = await empaquetarYGuardar(conversion.reseñas, validacion.ficha, ctx);

  const salida: SalidaProcesarLote = {
    id: paquete.id,
    conteos: paquete.conteos,
    resumen: paquete.resumen,
    fichaFaltantes: validacion.faltantes,
  };

  responderJSON(res, 200, salida);
}

/**
 * Corre `procesarLote` sobre `reseñas`, arma el paquete (CSV + Markdown) y lo
 * guarda en el almacén. Compartido entre `POST /lotes` (RS.14) y
 * `POST /lotes/importar` (RS.25): ambos terminan igual una vez que tienen
 * `ReseñaNegocio[]` en la mano — lo único que cambia es de dónde vienen.
 */
async function empaquetarYGuardar(
  reseñas: ReseñaNegocio[],
  ficha: FichaNegocio,
  ctx: Pick<ContextoManejo, "redactor" | "almacen">,
): Promise<{
  id: string;
  conteos: { listas: number; paraRevision: number; fallaron: number };
  resumen: ResumenDeQuejas;
}> {
  const loteProcesado = await procesarLote(reseñas, ficha, ctx.redactor);
  const lote = loteProcesado.resultado;

  const resumen = resumirQuejas(lote);
  const filas = filasDelLote(lote, reseñas);
  const csv = exportarCSV(filas);
  const markdown = exportarMarkdown(lote, reseñas, ficha.nombre);

  const id = randomUUID();
  ctx.almacen.guardar(id, { csv, markdown, filas, ficha });

  return {
    id,
    conteos: { listas: lote.listas, paraRevision: lote.paraRevision, fallaron: lote.fallaron },
    resumen,
  };
}

async function manejarPOSTLoteImportar(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ContextoManejo,
): Promise<void> {
  if (ctx.importador === undefined) {
    responderJSON(res, 501, {
      motivo: "la importación automática no está configurada en este servidor.",
    });
    return;
  }

  const cuerpo = await leerCuerpo(req).catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    return `__error__:${msg}`;
  });
  if (typeof cuerpo === "string" && cuerpo.startsWith("__error__:")) {
    responderJSON(res, 400, {
      motivo: `no se pudo leer el cuerpo de la petición: ${cuerpo.slice("__error__:".length)}`,
    });
    return;
  }

  let entrada: EntradaImportarLote;
  try {
    const parsed: unknown = JSON.parse(cuerpo);
    if (!esObjeto(parsed)) {
      responderJSON(res, 400, {
        motivo: "el cuerpo debe ser un objeto JSON con 'placeId' y 'ficha'.",
      });
      return;
    }
    entrada = parsed as unknown as EntradaImportarLote;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    responderJSON(res, 400, {
      motivo: `JSON inválido en el cuerpo de la petición: ${msg}`,
    });
    return;
  }

  if (typeof entrada.placeId !== "string" || entrada.placeId.trim().length === 0) {
    responderJSON(res, 400, { motivo: "falta 'placeId' (identificador del negocio)." });
    return;
  }

  if (entrada.ficha === undefined || entrada.ficha === null) {
    responderJSON(res, 400, { motivo: "falta la ficha del negocio." });
    return;
  }
  const validacion = validarFicha(entrada.ficha);
  if (!validacion.ok) {
    responderJSON(res, 400, { motivo: `ficha inválida: ${validacion.motivo}` });
    return;
  }

  let importacion;
  try {
    importacion = await ctx.importador.importarNuevas(entrada.placeId);
  } catch (error: unknown) {
    const msg = error instanceof ImportadorError ? error.message : "no se pudo importar el lote.";
    responderJSON(res, 502, { motivo: msg });
    return;
  }

  const maxEfectivo = limiteDePeticion(entrada.maxReseñas, ctx.maxReseñasPorLote);
  if (importacion.reseñas.length > maxEfectivo) {
    responderJSON(res, 400, {
      motivo:
        `el proveedor devolvió ${importacion.reseñas.length} reseñas nuevas y el máximo ` +
        `configurado es ${maxEfectivo}. Ajuste el tope o procese en partes.`,
    });
    return;
  }

  if (importacion.reseñas.length === 0) {
    const salidaVacia: SalidaImportarLote = {
      id: null,
      totalRecibidas: importacion.totalRecibidas,
      nuevas: 0,
      yaVistas: importacion.yaVistas,
      conteos: { listas: 0, paraRevision: 0, fallaron: 0 },
      resumen: resumirQuejas({ resultados: [], listas: 0, paraRevision: 0, fallaron: 0 }),
      fichaFaltantes: validacion.faltantes,
    };
    responderJSON(res, 200, salidaVacia);
    return;
  }

  const paquete = await empaquetarYGuardar(importacion.reseñas, validacion.ficha, ctx);

  const salida: SalidaImportarLote = {
    id: paquete.id,
    totalRecibidas: importacion.totalRecibidas,
    nuevas: importacion.nuevas,
    yaVistas: importacion.yaVistas,
    conteos: paquete.conteos,
    resumen: paquete.resumen,
    fichaFaltantes: validacion.faltantes,
  };

  responderJSON(res, 200, salida);
}

async function manejarGETEnlace(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ContextoManejo,
  id: string,
): Promise<void> {
  const paquete = ctx.almacen.obtener(id);
  if (paquete === null) {
    responderJSON(res, 404, { motivo: "no se encontró el paquete." });
    return;
  }
  const enlace = ctx.almacen.generarEnlace(id, ctx.plazoCaducidadMs);
  responderJSON(res, 200, {
    token: enlace.token,
    url: `/enlace/${enlace.token}`,
  });
}

async function manejarGETEnlaceToken(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ContextoManejo,
  token: string,
): Promise<void> {
  void ctx;
  const paquete = ctx.almacen.canjearEnlace(token);
  if (paquete === null) {
    responderJSON(res, 410, { motivo: "el enlace no es válido o ha caducado." });
    return;
  }
  for (const [k, v] of ENCABEZADOS_CSV) {
    res.setHeader(k, v);
  }
  res.statusCode = 200;
  res.end(paquete.csv);
}

function manejarGETPaquete(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ContextoManejo,
  id: string,
): void {
  const paquete = ctx.almacen.obtener(id);
  if (paquete === null) {
    responderJSON(res, 404, {
      motivo: `no hay un paquete con identificador "${id}".`,
    });
    return;
  }
  for (const [k, v] of ENCABEZADOS_CSV) {
    res.setHeader(k, v);
  }
  res.statusCode = 200;
  res.end(paquete.csv);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers HTTP
// ─────────────────────────────────────────────────────────────────────────────

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolver, rechazar) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolver(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err: Error) => {
      rechazar(err);
    });
  });
}

function responderJSON(
  res: ServerResponse,
  estado: number,
  cuerpo: unknown,
): void {
  const texto = JSON.stringify(cuerpo);
  res.statusCode = estado;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(texto);
}

/**
 * Averigua el límite efectivo para esta petición. El cliente puede enviar un
 * `maxReseñas` por body, pero el servidor solo lo acepta si NO supera el
 * tope configurado: un cliente no puede saltarse el límite del operador.
 */
function limiteDePeticion(
  maxDelCliente: unknown,
  maxDelServidor: number,
): number {
  if (maxDelCliente === undefined || maxDelCliente === null) {
    return maxDelServidor;
  }
  if (typeof maxDelCliente !== "number" || !Number.isInteger(maxDelCliente)) {
    // Un valor inválido no se interpreta: usamos el del servidor.
    return maxDelServidor;
  }
  if (maxDelCliente < 1) return maxDelServidor;
  // El cliente puede PEDIR un tope más bajo (útil para una vista previa), pero
  // nunca uno más alto que el del operador.
  return maxDelCliente < maxDelServidor ? maxDelCliente : maxDelServidor;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}