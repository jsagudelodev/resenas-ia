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
  type AlmacenRespuestas,
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
