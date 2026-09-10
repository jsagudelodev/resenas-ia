// RS.27 — El catálogo de negocios sobrevive a reiniciar el proceso.
//
// `ProgramadorImportacion` (RS.26) registra negocios en un `Map` en memoria:
// se pierden al reiniciar el proceso, así que cada reinicio obliga a volver
// a listar los negocios a mano en `opciones.programadorImportacion.negocios`.
// Este módulo persiste esa lista (placeId → ficha) para que el programador
// la recargue sola al arrancar.
//
// Mismo patrón que el resto del proyecto para persistencia (`AlmacenRespuestasSqlite`,
// `ServicioSaldoCliente`, `AlmacenImportacionSqlite`): una interfaz con una
// implementación en memoria (pruebas, o quien no quiera tocar disco) y una en
// `node:sqlite` que sobrevive a cerrar el proceso.

import { DatabaseSync } from "node:sqlite";
import type { FichaNegocio } from "./fichaNegocio.js";
import type { NegocioProgramado } from "./programadorImportacion.js";

/** Contrato del catálogo persistente de negocios bajo seguimiento automático. */
export interface CatalogoNegocios {
  /** Da de alta o actualiza (si el `placeId` ya existía) un negocio. */
  registrar(negocio: NegocioProgramado): Promise<void>;
  /** Quita un negocio. Devuelve `false` si no estaba. */
  quitar(placeId: string): Promise<boolean>;
  /** Todos los negocios guardados. */
  listar(): Promise<NegocioProgramado[]>;
  cerrar(): void;
}

/** Implementación volátil: para pruebas o para quien no quiera tocar disco. */
export class CatalogoNegociosEnMemoria implements CatalogoNegocios {
  private readonly negocios = new Map<string, NegocioProgramado>();

  async registrar(negocio: NegocioProgramado): Promise<void> {
    this.negocios.set(negocio.placeId, negocio);
  }

  async quitar(placeId: string): Promise<boolean> {
    return this.negocios.delete(placeId);
  }

  async listar(): Promise<NegocioProgramado[]> {
    return Array.from(this.negocios.values());
  }

  cerrar(): void {
    this.negocios.clear();
  }
}

const CREAR_TABLA = `
CREATE TABLE IF NOT EXISTS negocios_programados (
  place_id       TEXT PRIMARY KEY,
  ficha_json     TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
)
`;

/**
 * Persistencia en SQLite. La ficha se guarda como JSON: es la única forma
 * práctica de persistir un objeto de forma arbitraria (con `sucursal`
 * opcional, listas de gestos, etc.) sin inventar una columna por campo y sin
 * arrastrar ese esquema cada vez que `FichaNegocio` cambie.
 */
export class CatalogoNegociosSqlite implements CatalogoNegocios {
  private readonly base: DatabaseSync;

  constructor(ruta: string) {
    this.base = new DatabaseSync(ruta);
    this.base.exec(CREAR_TABLA);
  }

  async registrar(negocio: NegocioProgramado): Promise<void> {
    this.base
      .prepare(
        `INSERT INTO negocios_programados (place_id, ficha_json, actualizado_en)
         VALUES (?, ?, ?)
         ON CONFLICT(place_id) DO UPDATE SET
           ficha_json = excluded.ficha_json,
           actualizado_en = excluded.actualizado_en`,
      )
      .run(negocio.placeId, JSON.stringify(negocio.ficha), new Date().toISOString());
  }

  async quitar(placeId: string): Promise<boolean> {
    const resultado = this.base
      .prepare("DELETE FROM negocios_programados WHERE place_id = ?")
      .run(placeId);
    return resultado.changes > 0;
  }

  async listar(): Promise<NegocioProgramado[]> {
    const filas = this.base
      .prepare("SELECT place_id, ficha_json FROM negocios_programados")
      .all() as { place_id: string; ficha_json: string }[];
    return filas.map((fila) => ({
      placeId: fila.place_id,
      // `as FichaNegocio`: cruce de frontera de un `unknown` que viene de
      // `JSON.parse` sobre un valor que ESTE MISMO módulo escribió con
      // `JSON.stringify(negocio.ficha)` en `registrar` — no es entrada de
      // un tercero, pero sigue siendo un `unknown` hasta que se nombra.
      ficha: JSON.parse(fila.ficha_json) as FichaNegocio,
    }));
  }

  cerrar(): void {
    this.base.close();
  }
}
