// RS.13 — Ni un nombre de reseñador en el log.
//
// El log del servicio NO puede contener datos de terceros (regla 10):
// ni el nombre de un reseñador ni la clave del proveedor de IA. La regla
// se aplica en este módulo, no en cada uno de los llamadores: cuando un
// componente decide registrar algo, pasa los datos crudos a `registrar` y
// `RegistradorSeguro` se encarga de limpiarlos antes de mandarlos al
// `Registrador` final (que en producción escribiría a `stderr` o a un
// archivo).
//
// La sanitización se hace por **ocultación explícita**: el `RegistradorSeguro`
// recibe una lista de cadenas sensibles (los nombres de los reseñadores del
// lote y la credencial configurada) y reemplaza cualquier aparición por
// `[REDACTED]`. La lista la arma el llamador UNA VEZ por lote y la pasa
// junto con cada evento. Esto evita que el módulo «conozca» la forma de
// los datos: si mañana el lote trae un campo nuevo sensible, basta con
// añadirlo a la lista.
//
// La sanitización cubre el mensaje Y todos los campos del contexto: un
// mensaje corto puede incluir el dato por accidente (ej. un `Error.message`
// que arrastra el autor), y un `contexto` con un objeto arbitrario puede
// traer la credencial en cualquier nivel. La función `aplanar` recorre el
// objeto y sanitiza cada valor de tipo `string`. Las claves de los campos
// no se tocan: solo el contenido.
//
// Sustituible sin tocar al resto del código: la interfaz `Registrador` es
// un único método `registrar`, y el módulo expone un `RegistradorEstandar`
// que escribe a `stderr` para el binario de producción.

export type Nivel = "info" | "aviso" | "error";

/**
 * Contexto libre que el llamador puede adjuntar a un evento de log.
 * Cualquier valor de tipo `string` en cualquier profundidad será
 * sanitizado antes de salir al `Registrador` subyacente.
 */
export type Contexto = Readonly<Record<string, unknown>>;

/**
 * Un evento ya formateado: nivel, mensaje y contexto. Es lo que el
 * `Registrador` final ve, ya sanitizado.
 */
export interface Evento {
  nivel: Nivel;
  mensaje: string;
  contexto: Contexto;
}

/**
 * Contrato del registrador final. Una implementación real escribe a
 * `stderr`, a un archivo o a un colector externo; `RegistradorDePrueba`
 * guarda los eventos en memoria y `RegistradorEstandar` va a `stderr`.
 */
export interface Registrador {
  registrar(evento: Evento): void;
}

/**
 * Lista de cadenas que `RegistradorSeguro` ocultará en los mensajes y en
 * los valores del contexto. Vacía = no oculta nada (útil para tests que
 * verifican el camino feliz).
 */
export interface ListaDeSaneamiento {
  readonly sensibles: string[];
}

/**
 * Construye una lista de saneamiento a partir del lote y la credencial
 * configurada. El nombre de un reseñador puede ser cualquier cadena que
 * aparezca en `reseña.autor` (o el literal `"anónimo"` cuando el autor
 * está vacío), y la API key se trata como una sola cadena más.
 */
export function listaDeSaneamientoDeLote(
  autores: ReadonlyArray<string>,
  credencialApi: string | null,
): ListaDeSaneamiento {
  const sensibles = new Set<string>();
  for (const autor of autores) {
    const limpio = autor.trim();
    if (limpio.length > 0) {
      sensibles.add(limpio);
    }
  }
  if (credencialApi !== null && credencialApi.trim().length > 0) {
    sensibles.add(credencialApi.trim());
  }
  return { sensibles: Array.from(sensibles) };
}

/**
 * Reemplaza en `texto` cada cadena sensible por `[REDACTED]`. Si dos
 * sensibles se solapan, se aplica primero la más larga para evitar que la
 * sustitución parcial de la mayor deje un fragmento visible.
 */
export function ocultarCadenas(
  texto: string,
  sensibles: ReadonlyArray<string>,
): string {
  if (texto.length === 0 || sensibles.length === 0) return texto;
  const ordenadas = [...sensibles].sort((a, b) => b.length - a.length);
  let resultado = texto;
  for (const s of ordenadas) {
    if (s.length === 0) continue;
    resultado = resultado.split(s).join("[REDACTED]");
  }
  return resultado;
}

function aplanar(valor: unknown): unknown {
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) {
    return valor.map((v) => aplanar(v));
  }
  if (valor !== null && typeof valor === "object") {
    const resultado: Record<string, unknown> = {};
    for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
      resultado[clave] = aplanar(v);
    }
    return resultado;
  }
  return valor;
}

/**
 * Registrador que envuelve a otro y oculta cadenas sensibles. Es el que
 * se pasa a `procesarLote` y `generarRespuesta`: cualquier evento pasa
 * antes por la sanitización.
 */
export class RegistradorSeguro implements Registrador {
  private readonly siguiente: Registrador;
  private readonly sensibles: ReadonlyArray<string>;

  constructor(siguiente: Registrador, lista: ListaDeSaneamiento) {
    this.siguiente = siguiente;
    this.sensibles = lista.sensibles;
  }

  registrar(evento: Evento): void {
    const mensaje = ocultarCadenas(evento.mensaje, this.sensibles);
    const contexto = ocultarCadenas(
      JSON.stringify(aplanar(evento.contexto)),
      this.sensibles,
    ) as string;
    let contextoObjeto: Contexto;
    try {
      contextoObjeto = JSON.parse(contexto) as Contexto;
    } catch {
      // Si la sanitización rompiera la estructura (no debería), caemos a
      // un contexto vacío para no perder el mensaje principal.
      contextoObjeto = {};
    }
    this.siguiente.registrar({
      nivel: evento.nivel,
      mensaje,
      contexto: contextoObjeto,
    });
  }
}

/**
 * Registrador que escribe a `stderr` línea a línea. Es el que usa el
 * binario de producción. No se usa en los tests: la regla 7 los obliga
 * a no tocar `stderr`, y `RegistradorDePrueba` cubre esa necesidad.
 */
export class RegistradorEstandar implements Registrador {
  registrar(evento: Evento): void {
    const texto = evento.contexto !== undefined && Object.keys(evento.contexto).length > 0
      ? `${evento.nivel.toUpperCase()} ${evento.mensaje} ${JSON.stringify(evento.contexto)}`
      : `${evento.nivel.toUpperCase()} ${evento.mensaje}`;
    process.stderr.write(texto + "\n");
  }
}

/**
 * Registrador de pruebas: guarda los eventos en un buffer en memoria.
 * Útil para que la suite verifique qué se escribiría en producción sin
 * contaminar `stderr`. Cumple la regla 7 (sin red ni credenciales) y la
 * regla 10 (los eventos que ve son los que el `RegistradorSeguro` ya
 * limpió).
 */
export class RegistradorDePrueba implements Registrador {
  private readonly eventos: Evento[] = [];

  registrar(evento: Evento): void {
    this.eventos.push(evento);
  }

  /** Eventos recibidos hasta ahora, en orden de llegada. */
  get Eventos(): ReadonlyArray<Evento> {
    return this.eventos;
  }

  /** Todas las líneas que saldrían al log, una por evento. */
  aLineas(): string[] {
    return this.eventos.map((e) =>
      Object.keys(e.contexto).length > 0
        ? `${e.nivel.toUpperCase()} ${e.mensaje} ${JSON.stringify(e.contexto)}`
        : `${e.nivel.toUpperCase()} ${e.mensaje}`,
    );
  }
}

/**
 * Función de ayuda para que el llamador arme el evento: garantiza el
 * tipo y aplica el `RegistradorSeguro` configurado. No exporta la
 * sanitización por separado para que ningún camino del código se la
 * salte.
 */
export function registrar(
  regs: RegistradorSeguro,
  nivel: Nivel,
  mensaje: string,
  contexto: Contexto = {},
): void {
  regs.registrar({ nivel, mensaje, contexto });
}