// RS.26 — Traer lo nuevo sola, sin que nadie la dispare.
//
// Hoy alguien tiene que llamar `POST /lotes/importar` a mano por cada
// negocio. Este módulo programa esa llamada: recorre los negocios
// registrados a un intervalo fijo y, si un negocio trae reseñas nuevas, las
// pasa al pipeline existente (RS.14/RS.25) mediante un callback inyectado —
// este módulo no sabe qué es "procesar un lote", solo cuándo y para quién.
//
// El temporizador es INYECTABLE (mismo patrón que `TransporteHttp` para el
// LLM y `TransporteImportacion` para el proveedor de reseñas): la suite
// dispara un ciclo llamando directamente a la función que el temporizador
// falso capturó, sin esperar ningún intervalo real ni usar temporizadores
// reales de por medio.
//
// Un negocio que falla (el proveedor no respondió, el pipeline lanzó) NO
// cancela el ciclo para los demás — mismo principio que RS.8 ("una reseña
// que falla no tumba el lote"), aplicado aquí a "un negocio que falla no
// tumba la corrida".
//
// RS.27 añadió persistencia opcional: si se inyecta un `CatalogoNegocios`,
// `registrarNegocio`/`quitarNegocio` escriben a través de él (además del
// `Map` en memoria) y `cargarDesdeCatalogo()` recupera lo guardado al
// arrancar — sin catálogo, el comportamiento es el mismo de antes: solo
// memoria del proceso. El aviso al dueño cuando el paquete queda listo sigue
// pendiente (RS.28): el hueco para eso es `alTerminarCiclo`.

import type { FichaNegocio } from "./fichaNegocio.js";
import type { ReseñaNegocio } from "./convertirReseñas.js";
import type { ResultadoImportacion } from "./importadorReseñas.js";
import type { CatalogoNegocios } from "./catalogoNegocios.js";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

/** Un negocio bajo seguimiento automático. */
export interface NegocioProgramado {
  placeId: string;
  ficha: FichaNegocio;
}

/**
 * Lo mínimo que el programador necesita de un importador: traer las reseñas
 * nuevas de un negocio. `ImportadorReseñas` ya cumple esta forma; se declara
 * aparte para que los tests puedan pasar uno falso sin montar transporte ni
 * almacén de deduplicación.
 */
export interface FuenteDeReseñasNuevas {
  importarNuevas(placeId: string): Promise<ResultadoImportacion>;
}

/**
 * Lo que devuelve `alProcesarNuevas` cuando produjo un paquete descargable.
 * RS.28 lo usa para armar el aviso (enlace + conteos) sin que este módulo
 * conozca nada de `empaquetar.ts` ni de `AlmacenDeLotes`.
 */
export interface PaqueteProducido {
  id: string;
  conteos: { listas: number; paraRevision: number; fallaron: number };
}

/**
 * Qué hacer cuando un negocio trae reseñas nuevas. Lo inyecta quien compone
 * el programador (típicamente `procesarLote` + empaquetar + guardar); este
 * módulo no conoce esa lógica. Puede devolver `undefined` si no hay nada que
 * reportar (p. ej. el pipeline decidió no generar paquete).
 */
export type ManejadorDeReseñasNuevas = (
  negocio: NegocioProgramado,
  reseñas: ReseñaNegocio[],
) => Promise<PaqueteProducido | undefined>;

/** Resultado de intentar un negocio dentro de un ciclo. */
export interface ResultadoCicloNegocio {
  placeId: string;
  ok: boolean;
  nuevas: number;
  /** Solo presente cuando `ok` es `false`. */
  motivo?: string;
  /** Solo presente cuando `alProcesarNuevas` produjo (y reportó) un paquete. */
  paquete?: PaqueteProducido;
}

/** Manejador de un temporizador activo: lo único que se necesita es poder cancelarlo. */
export interface ManejadorDeTemporizador {
  cancelar(): void;
}

/**
 * Fuente de intervalos repetidos. Se inyecta para que la suite dispare un
 * ciclo llamando directamente a la función capturada, sin depender de
 * `setInterval` real ni de esperar el paso del tiempo.
 */
export interface Temporizador {
  cada(intervaloMs: number, fn: () => void): ManejadorDeTemporizador;
}

/** Temporizador real: `setInterval` de Node. Es lo que usa producción. */
export class TemporizadorReal implements Temporizador {
  cada(intervaloMs: number, fn: () => void): ManejadorDeTemporizador {
    const id = setInterval(fn, intervaloMs);
    // `unref()`: un programador activo no debe impedir que el proceso
    // termine si no hay nada más que hacer (relevante en tests y en scripts
    // cortos que arrancan el servidor y lo cierran).
    id.unref?.();
    return { cancelar: () => clearInterval(id) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Programador
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recorre los negocios registrados a un intervalo fijo y, por cada uno con
 * reseñas nuevas, llama a `alProcesarNuevas`. Pensado para vivir dentro del
 * proceso del servidor HTTP (RS.14/RS.25), pero no depende de `node:http`:
 * un script de línea de comandos podría usarlo igual.
 */
export class ProgramadorImportacion {
  private readonly negocios = new Map<string, NegocioProgramado>();
  private temporizadorActivo: ManejadorDeTemporizador | null = null;

  constructor(
    private readonly fuente: FuenteDeReseñasNuevas,
    private readonly alProcesarNuevas: ManejadorDeReseñasNuevas,
    private readonly temporizador: Temporizador = new TemporizadorReal(),
    /**
     * Se llama al terminar cada ciclo automático (vía `iniciar`), con el
     * resultado de todos los negocios. No se llama tras un
     * `ejecutarCicloUnaVez()` manual: quien lo invocó ya tiene el resultado
     * como valor de retorno. Hueco pensado para que RS.28 (aviso al dueño)
     * y para logging del operador se enchufen sin tocar este módulo.
     */
    private readonly alTerminarCiclo?: (resultados: ResultadoCicloNegocio[]) => void,
    /**
     * RS.27 — si se pasa, `registrarNegocio`/`quitarNegocio` escriben a
     * través de él y `cargarDesdeCatalogo()` puede recuperar lo guardado
     * (sobrevive a reiniciar el proceso). Sin él, el seguimiento vive solo
     * en memoria, como antes de RS.27.
     */
    private readonly catalogo?: CatalogoNegocios,
  ) {}

  /**
   * Da de alta (o actualiza, si ya existía) un negocio bajo seguimiento.
   * Si hay catálogo, lo persiste ahí también (punto 3 del cierre de RS.27:
   * sobrevive a reiniciar el proceso).
   */
  async registrarNegocio(negocio: NegocioProgramado): Promise<void> {
    this.negocios.set(negocio.placeId, negocio);
    if (this.catalogo !== undefined) {
      await this.catalogo.registrar(negocio);
    }
  }

  /**
   * Quita un negocio del seguimiento (y del catálogo, si hay uno). Devuelve
   * `false` si no estaba en memoria.
   */
  async quitarNegocio(placeId: string): Promise<boolean> {
    const estaba = this.negocios.delete(placeId);
    if (this.catalogo !== undefined) {
      await this.catalogo.quitar(placeId);
    }
    return estaba;
  }

  /**
   * Carga en memoria los negocios guardados en el catálogo. Pensado para
   * llamarse una vez al arrancar el proceso, ANTES de `iniciar`. Sin
   * catálogo configurado, no hace nada.
   */
  async cargarDesdeCatalogo(): Promise<void> {
    if (this.catalogo === undefined) return;
    const guardados = await this.catalogo.listar();
    for (const negocio of guardados) {
      this.negocios.set(negocio.placeId, negocio);
    }
  }

  /** Negocios bajo seguimiento en este momento. */
  listarNegocios(): NegocioProgramado[] {
    return Array.from(this.negocios.values());
  }

  /** `true` mientras el programador está corriendo (entre `iniciar` y `detener`). */
  get corriendo(): boolean {
    return this.temporizadorActivo !== null;
  }

  /**
   * Ejecuta una pasada sobre todos los negocios registrados EN ESTE momento
   * (si uno se agrega o se quita a mitad de un ciclo, ese ciclo ya empezó
   * con la lista que tenía). Un negocio que falla (proveedor caído, el
   * callback lanza) queda registrado como `ok: false` con motivo, y el ciclo
   * sigue con el siguiente negocio.
   */
  async ejecutarCicloUnaVez(): Promise<ResultadoCicloNegocio[]> {
    const resultados: ResultadoCicloNegocio[] = [];
    for (const negocio of this.negocios.values()) {
      try {
        const importacion = await this.fuente.importarNuevas(negocio.placeId);
        let paquete: PaqueteProducido | undefined;
        if (importacion.reseñas.length > 0) {
          paquete = await this.alProcesarNuevas(negocio, importacion.reseñas);
        }
        resultados.push({
          placeId: negocio.placeId,
          ok: true,
          nuevas: importacion.nuevas,
          ...(paquete !== undefined ? { paquete } : {}),
        });
      } catch (error: unknown) {
        const motivo = error instanceof Error ? error.message : String(error);
        resultados.push({ placeId: negocio.placeId, ok: false, nuevas: 0, motivo });
      }
    }
    return resultados;
  }

  /**
   * Arranca el seguimiento automático cada `intervaloMs`. Si ya estaba
   * corriendo, no hace nada (idempotente: llamar dos veces no duplica el
   * temporizador).
   */
  iniciar(intervaloMs: number): void {
    if (this.temporizadorActivo !== null) return;
    this.temporizadorActivo = this.temporizador.cada(intervaloMs, () => {
      void this.ejecutarCicloUnaVez().then((resultados) => {
        this.alTerminarCiclo?.(resultados);
      });
    });
  }

  /** Detiene el seguimiento automático. Llamar sin haber iniciado no hace nada. */
  detener(): void {
    this.temporizadorActivo?.cancelar();
    this.temporizadorActivo = null;
  }
}
