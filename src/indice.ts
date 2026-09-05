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

import {
  claveDePrompt,
  AlmacenRespuestasEnMemoria,
  AlmacenRespuestasSqlite,
  RedactorConMemoria,
  type AlmacenRespuestas,
} from "./almacenRespuestas.js";

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
  claveDePrompt,
  AlmacenRespuestasEnMemoria,
  AlmacenRespuestasSqlite,
  RedactorConMemoria,
};
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
};
export { UMBRAL_MINIMO_DEFECTO };
