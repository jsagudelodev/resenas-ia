// Punto de entrada público del paquete.
// RS.0: expone la versión y reexporta lo ya disponible de RS.1.
// RS.2: reexporta además la ficha del negocio.
import { convertirReseñas, type ReseñaNegocio } from "./convertirReseñas.js";
import {
  validarFicha,
  type FichaNegocio,
  type FichaValida,
  type FichaInvalida,
  type ResultadoValidacionFicha,
  type Tono,
  type Contacto,
  type LoQueOfrece,
  type LoQueNoOfrece,
  // RS.11: tipo de la sucursal, reexportado para que el cliente del paquete
  // no tenga que importar del módulo interno.
  type Sucursal,
} from "./fichaNegocio.js";
import {
  generarRespuesta,
  construirPrompt,
  type ResultadoRedaccion,
  type RespuestaLista,
  type RespuestaNoDisponible,
  type RespuestaParaRevision,
} from "./generarRespuesta.js";
import {
  detectarGravedad,
  type CategoriaGravedad,
  type ResultadoGravedad,
} from "./detectorGravedad.js";
import {
  RedactorFalso,
  type Redactor,
} from "./redactor.js";
import {
  revisar,
  type ResultadoRevision,
  type RevisionOk,
  type RevisionRechazada,
} from "./revisarRespuesta.js";
import {
  detectarInyeccion,
  type ResultadoDeteccion,
  type IntentoDeInyeccion,
  type CategoriaInyeccion,
} from "./detectarInyeccion.js";
import {
  detectarIdioma,
  type Idioma,
  type ResultadoDeteccionIdioma,
} from "./detectorIdioma.js";
import { procesarLote } from "./procesarLote.js";
import type { ResultadoProcesamientoLote } from "./procesarLote.js";
import {
  resumirQuejas,
  UMBRAL_MINIMO_DEFECTO,
  type ResumenDeQuejas,
  type MotivoQueja,
} from "./resumirQuejas.js";

// RS.12: paquete CSV + Markdown.
import {
  exportarCSV,
  exportarMarkdown,
  parsearCSV,
  filasDelLote,
  filasListasDelLote,
  separarParaRevisionYFallida,
  separarPublicadasYNuevas,
  CABECERA_CSV,
  SEPARADOR_CSV,
  BOM_UTF8,
  type FilaPaquete,
  type EstadoEnPaquete,
  type ResultadoLecturaCSV,
  type PilasDelPaquete,
} from "./empaquetar.js";

import {
  claveDePrompt,
  AlmacenRespuestasEnMemoria,
  AlmacenRespuestasSqlite,
  RedactorConMemoria,
  MarcarRespuestasPublicadas,
  type AlmacenRespuestas,
  type RespuestaPublicada,
} from "./almacenRespuestas.js";

// RS.14: servicio HTTP que recibe el lote y devuelve el paquete.
import {
  crearServidor,
  MAX_RESEÑAS_POR_LOTE_DEFECTO,
  AlmacenDeLotesEnMemoria,
  type OpcionesServidor,
  type AlmacenDeLotes,
  type PaqueteAlmacenado,
  type EntradaProcesarLote,
  type SalidaProcesarLote,
  type ServidorLevantado,
  // RS.25: endpoint de importación automática.
  type EntradaImportarLote,
  type SalidaImportarLote,
} from "./servicio.js";

// RS.13: módulo de log con saneamiento de credenciales y nombres de
// reseñadores (regla 10).
import {
  listaDeSaneamientoDeLote,
  ocultarCadenas,
  RegistradorEstandar,
  RegistradorSeguro,
  RegistradorDePrueba,
  type Contexto,
  type Evento,
  type Nivel,
  type Registrador,
  type ListaDeSaneamiento,
} from "./registro.js";
// RS.16: saldo de cliente con persistencia SQLite.
import {
  ServicioSaldoCliente,
  type SaldoCliente,
  type DescontarRespuestas,
} from "./saldoCliente.js";

// RS.21: redactor real (el que llama a un modelo por HTTP) y su transporte,
// exportados para que el cliente del paquete pueda usar un proveedor real.
import {
  RedactorReal,
  crearTransporteReal,
  type TransporteHttp,
  type RespuestaBruta,
} from "./redactorReal.js";

// Importador de reseñas: automatiza el copiar/pegar manual para escalar a
// varios negocios sin intervención por cliente en cada corrida.
import {
  ImportadorReseñas,
  ImportadorError,
  AlmacenImportacionEnMemoria,
  AlmacenImportacionSqlite,
  crearTransporteImportacionReal,
  TransporteImportacionReal,
  type ReseñaImportada,
  type TransporteImportacion,
  type AlmacenImportacion,
  type ResultadoImportacion,
} from "./importadorReseñas.js";

// RS.26: programador de importación automática (seguimiento periódico de
// negocios, sin que nadie llame al endpoint a mano).
import {
  ProgramadorImportacion,
  TemporizadorReal,
  type NegocioProgramado,
  type FuenteDeReseñasNuevas,
  type ManejadorDeReseñasNuevas,
  type ResultadoCicloNegocio,
  type Temporizador,
  type ManejadorDeTemporizador,
  type PaqueteProducido,
} from "./programadorImportacion.js";

// RS.27: catálogo persistente de negocios (sobrevive a reiniciar el proceso).
import {
  CatalogoNegociosEnMemoria,
  CatalogoNegociosSqlite,
  type CatalogoNegocios,
} from "./catalogoNegocios.js";

// RS.28: aviso automático cuando un negocio tiene un paquete nuevo listo.
import {
  NotificadorWebhook,
  NotificadorError,
  crearNotificadorWebhook,
  type Notificador,
  type AvisoPaquete,
} from "./notificador.js";

export const version: string = "0.0.0";

export {
  convertirReseñas,
  validarFicha,
  generarRespuesta,
  construirPrompt,
  RedactorFalso,
  revisar,
  detectarInyeccion,
  detectarGravedad,
  detectarIdioma,
  procesarLote,
  resumirQuejas,
  // RS.12: funciones del paquete CSV/Markdown.
  exportarCSV,
  exportarMarkdown,
  parsearCSV,
  filasDelLote,
  filasListasDelLote,
  separarParaRevisionYFallida,
  claveDePrompt,
  AlmacenRespuestasEnMemoria,
  AlmacenRespuestasSqlite,
  RedactorConMemoria,
  MarcarRespuestasPublicadas,
  // RS.14: servicio HTTP.
  crearServidor,
  MAX_RESEÑAS_POR_LOTE_DEFECTO,
  AlmacenDeLotesEnMemoria,
  // RS.13: registro sanitizado.
  listaDeSaneamientoDeLote,
  ocultarCadenas,
  RegistradorEstandar,
  RegistradorSeguro,
  RegistradorDePrueba,
  // RS.16: saldo de cliente.
  ServicioSaldoCliente,
  // RS.21: redactor real y transporte HTTP.
  RedactorReal,
  crearTransporteReal,
  type TransporteHttp,
  type RespuestaBruta,
  // Importador de reseñas: extracción automática, sustituye el copiar/pegar.
  ImportadorReseñas,
  ImportadorError,
  AlmacenImportacionEnMemoria,
  AlmacenImportacionSqlite,
  crearTransporteImportacionReal,
  TransporteImportacionReal,
  type ReseñaImportada,
  type TransporteImportacion,
  type AlmacenImportacion,
  type ResultadoImportacion,
  // RS.26: programador de importación automática.
  ProgramadorImportacion,
  TemporizadorReal,
  type NegocioProgramado,
  type FuenteDeReseñasNuevas,
  type ManejadorDeReseñasNuevas,
  type ResultadoCicloNegocio,
  type Temporizador,
  type ManejadorDeTemporizador,
  // RS.25: tipos del endpoint de importación automática.
  type EntradaImportarLote,
  type SalidaImportarLote,
  // RS.27: catálogo persistente de negocios.
  CatalogoNegociosEnMemoria,
  CatalogoNegociosSqlite,
  type CatalogoNegocios,
  // RS.28: aviso automático de paquete listo.
  NotificadorWebhook,
  NotificadorError,
  crearNotificadorWebhook,
  type Notificador,
  type AvisoPaquete,
  // RS.26: tipo del paquete producido (para quien compone alTerminarCiclo).
  type PaqueteProducido,
};
export { CABECERA_CSV, SEPARADOR_CSV, BOM_UTF8 };
export type {
  ReseñaNegocio,
  FichaNegocio,
  FichaValida,
  FichaInvalida,
  ResultadoValidacionFicha,
  Tono,
  Contacto,
  LoQueOfrece,
  LoQueNoOfrece,
  SaldoCliente,
  DescontarRespuestas,
  // RS.11: reexport del tipo de la sucursal.
  Sucursal,
  ResultadoRedaccion,
  RespuestaLista,
  RespuestaNoDisponible,
  RespuestaParaRevision,
  CategoriaGravedad,
  ResultadoGravedad,
  Redactor,
  ResultadoRevision,
  RevisionOk,
  RevisionRechazada,
  ResultadoDeteccion,
  IntentoDeInyeccion,
  CategoriaInyeccion,
  Idioma,
  ResultadoDeteccionIdioma,
  ResultadoProcesamientoLote,
  ResumenDeQuejas,
  MotivoQueja,
  AlmacenRespuestas,
  // RS.15
  RespuestaPublicada,
  // RS.12: tipos del paquete.
  FilaPaquete,
  EstadoEnPaquete,
  ResultadoLecturaCSV,
  PilasDelPaquete,
  // RS.13: tipos del registro.
  Contexto,
  Evento,
  Nivel,
  Registrador,
  ListaDeSaneamiento,
  // RS.14: tipos del servicio.
  OpcionesServidor,
  AlmacenDeLotes,
  PaqueteAlmacenado,
  EntradaProcesarLote,
  SalidaProcesarLote,
  ServidorLevantado,
};
export { UMBRAL_MINIMO_DEFECTO };
