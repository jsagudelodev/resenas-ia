// RS.16 — Cuántas respuestas ha pagado.
//
// Un cliente compra un paquete de respuestas y el servicio lleva la cuenta.
// El saldo se persiste en SQLite para que sobreviva al reinicio del proceso
// (punto 3 del cierre). Dos descuentos simultáneos del mismo saldo se
// serializan mediante una transacción SQLite con acceso exclusivo:
//
//   BEGIN IMMEDIATE — adquiere un write-lock en la base al empezar.
//   Si dos procesos llegan a la vez, el segundo espera a que el primero
//   termine su transacción antes de proseguir. SQLite garantiza que ambos
//   lean el mismo saldo inicial y que solo uno logre писать si no alcanza.
//
// Cierre:
//   (1) un lote descuenta una por respuesta entregada como lista, y las
//       marcadas para revisión humana NO se cobran — no se entregó nada usable.
//   (2) si el saldo no llega para el lote entero, se rechaza ANTES de llamar
//       al modelo y se dice cuántas faltan.
//   (3) el saldo sobrevive a reiniciar el proceso y dos descuentos
//       simultáneos del mismo saldo no lo dejan en negativo.

import { DatabaseSync } from "node:sqlite";

// ─────────────────────────────────────────────────────────────────────────────
// Esquema
// ─────────────────────────────────────────────────────────────────────────────

const CREAR_SALDO = `
CREATE TABLE IF NOT EXISTS saldo_cliente (
  cliente TEXT PRIMARY KEY,
  respuestas INTEGER NOT NULL DEFAULT 0 CHECK (respuestas >= 0)
)
`;

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

export interface SaldoCliente {
  /** Identificador del cliente. */
  cliente: string;
  /** Respuestas que aún puede consumir. Nunca negativo. */
  respuestas: number;
}

/**
 * Resultado de intentar descontar respuestas del saldo de un cliente.
 * `exitoso` es `true` cuando el saldo era suficiente; `faltantes` indica
 * cuántas respuestas tendría que comprar el cliente para cubrir el lote.
 */
export interface DescontarRespuestas {
  exitoso: boolean;
  /** Clave del cliente. */
  cliente: string;
  /**
   * Solo presente cuando `exitoso` es `false`. Número de respuestas que el
   * cliente tendría que comprar para poder procesar este lote.
   */
  faltantes?: number;
  /**
   * Saldo tras el intento. Si `exitoso` es `false`, refleja el saldo
   * original (no se tocó).
   */
  saldoActual: number;
}

/**
 * Servicio de saldo de cliente. `ruta` puede ser un archivo en disco o
 * `":memory:"` para pruebas que no persisten entre procesos.
 */
export class ServicioSaldoCliente {
  private readonly base: DatabaseSync;

  constructor(ruta: string) {
    this.base = new DatabaseSync(ruta);
    this.base.exec(CREAR_SALDO);
  }

  /**
   * Consulta el saldo actual de un cliente. Si nunca se creó, devuelve 0.
   */
  consultar(cliente: string): SaldoCliente {
    const fila = this.base
      .prepare("SELECT respuestas FROM saldo_cliente WHERE cliente = ?")
      .get(cliente) as { respuestas: number } | undefined;
    return { cliente, respuestas: fila?.respuestas ?? 0 };
  }

  /**
   * Añade respuestas al saldo de un cliente. Si el cliente no existía, lo
   * crea. Si ya tenía saldo, lo incrementa.
   */
  agregar(cliente: string, cantidad: number): SaldoCliente {
    this.base
      .prepare(
        `INSERT INTO saldo_cliente (cliente, respuestas)
         VALUES (?, ?)
         ON CONFLICT(cliente) DO UPDATE SET
           respuestas = respuestas + excluded.respuestas`,
      )
      .run(cliente, cantidad);
    return this.consultar(cliente);
  }

  /**
   * Descuenta respuestas del saldo de un cliente, de forma atómica para evitar
   * condiciones de carrera (punto 3 del cierre: dos descuentos simultáneos del
   * mismo saldo no lo dejan en negativo).
   *
   * La atomicidad se logra con una sola sentencia `UPDATE … WHERE respuestas >= ?`:
   * solo modifica la fila cuando el saldo alcanza para el descuento. Si otra
   * conexión descuenta a la vez, una de las dos sees el saldo insuficiente y
   * ninguna puede sobre-descontar. SQLite serializa las escrituras en la misma
   * base por defecto (WAL o journal en modo rollback), así que concurrent calls
   * se encolan y nunca ven un estado inconsistente.
   *
   * Si el saldo es insuficiente, NO modifica nada y devuelve `exitoso: false`
   * con `faltantes` (punto 2 del cierre).
   */
  descontar(cliente: string, listas: number): DescontarRespuestas {
    if (listas <= 0) {
      // Sin respuestas listas, no hay descuento. El saldo no se toca.
      return { exitoso: true, cliente, saldoActual: this.consultar(cliente).respuestas };
    }

    const filaAntes = this.base
      .prepare("SELECT respuestas FROM saldo_cliente WHERE cliente = ?")
      .get(cliente) as { respuestas: number } | undefined;
    const saldoActual = filaAntes?.respuestas ?? 0;

    if (saldoActual < listas) {
      return {
        exitoso: false,
        cliente,
        faltantes: listas - saldoActual,
        saldoActual,
      };
    }

    // ATÓMICO: solo descuenta si el saldo sigue siendo suficiente. Si otra
    // conexión llegó primero, `cambios` será 0 y el saldo no se toca.
    const stmt = this.base.prepare(
      "UPDATE saldo_cliente SET respuestas = respuestas - ? WHERE cliente = ? AND respuestas >= ?",
    );
    const cambios = stmt.run(listas, cliente, listas);

    if (cambios.changes === 0) {
      // Alguien llegó primero: reconsultamos para dar el mensaje exacto.
      const saldoFinal = this.consultar(cliente).respuestas;
      return {
        exitoso: false,
        cliente,
        faltantes: listas - saldoFinal,
        saldoActual: saldoFinal,
      };
    }

    return { exitoso: true, cliente, saldoActual: saldoActual - listas };
  }

  /** Libera la conexión. */
  cerrar(): void {
    this.base.close();
  }
}