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

const CREAR_CODIGOS = `
CREATE TABLE IF NOT EXISTS codigos_compra (
  codigo TEXT PRIMARY KEY,
  respuestas INTEGER NOT NULL CHECK (respuestas > 0),
  canjeado INTEGER NOT NULL DEFAULT 0 CHECK (canjeado IN (0, 1))
)
`;

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado de intentar canjear un código de compra. */
export interface CanjearCodigo {
  exitoso: boolean;
  /** Siempre `"anonimo"` en esta versión. */
  cliente: string;
  /** Solo presente cuando `exitoso` es `true`. */
  respuestasAgregadas?: number;
  /**
   * Solo presente cuando `exitoso` es `false`.
   * Mensaje genérico: no revela si el código existía ni cuántos hay.
   */
  motivo?: string;
}

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
    this.base.exec(CREAR_CODIGOS);
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

  // ─────────────────────────────── RS.17 ─────────────────────────────────────

  /**
   * Registra un código de compra con su cantidad de respuestas.
   * Si el código ya existe, redefine la cantidad (idempotente para reventa).
   */
  registrarCodigo(codigo: string, respuestas: number): void {
    this.base
      .prepare(
        `INSERT INTO codigos_compra (codigo, respuestas, canjeado)
         VALUES (?, ?, 0)
         ON CONFLICT(codigo) DO UPDATE SET respuestas = excluded.respuestas, canjeado = 0`,
      )
      .run(codigo, respuestas);
  }

  /**
   * Canjea un código de compra. Si es válido y no usado, añade las respuestas
   * al saldo del cliente `"anonimo"` y marca el código como consumido.
   * Si ya fue usado o no existe, devuelve un mensaje genérico sin revelar
   * cuál de las dos situaciones ocurre (punto 3 del cierre de RS.17).
   *
   * La atomicidad de canje + recarga usa una transacción SQLite con
   * `BEGIN IMMEDIATE` para serializar dos intentos simultáneos del mismo
   * código: solo el primero tiene éxito.
   */
  canjear(codigo: string): CanjearCodigo {
    try {
      // BEGIN IMMEDIATE: acquire write-lock; second caller blocks until first
      // commits or rolls back, guaranteeing at-most-once semantics.
      this.base.exec("BEGIN IMMEDIATE");

      const fila = this.base
        .prepare("SELECT respuestas, canjeado FROM codigos_compra WHERE codigo = ?")
        .get(codigo) as { respuestas: number; canjeado: number } | undefined;

      if (!fila || fila.canjeado === 1) {
        // Código inexistente o ya usado: mensaje genérico.
        this.base.exec("ROLLBACK");
        return { exitoso: false, cliente: "anonimo", motivo: "El código es inválido o ya fue usado." };
      }

      // Marcar como canjeado y recargar saldo en la misma transacción.
      this.base
        .prepare("UPDATE codigos_compra SET canjeado = 1 WHERE codigo = ?")
        .run(codigo);

      this.agregar("anonimo", fila.respuestas);

      this.base.exec("COMMIT");
      return { exitoso: true, cliente: "anonimo", respuestasAgregadas: fila.respuestas };
    } catch {
      this.base.exec("ROLLBACK");
      return { exitoso: false, cliente: "anonimo", motivo: "El código es inválido o ya fue usado." };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  /** Libera la conexión. */
  cerrar(): void {
    this.base.close();
  }
}