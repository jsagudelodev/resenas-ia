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
} from "./fichaNegocio.js";
import {
  generarRespuesta,
  construirPrompt,
  type ResultadoRedaccion,
  type RespuestaLista,
  type RespuestaNoDisponible,
} from "./generarRespuesta.js";
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

export const version: string = "0.0.0";

export {
  convertirReseñas,
  validarFicha,
  generarRespuesta,
  construirPrompt,
  RedactorFalso,
  revisar,
  detectarInyeccion,
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
  ResultadoRedaccion,
  RespuestaLista,
  RespuestaNoDisponible,
  Redactor,
  ResultadoRevision,
  RevisionOk,
  RevisionRechazada,
  ResultadoDeteccion,
  IntentoDeInyeccion,
  CategoriaInyeccion,
};