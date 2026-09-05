// Punto de entrada público del paquete.
// RS.0: por ahora expone la versión y reexporta lo ya disponible de RS.1.
import { convertirReseñas, type ReseñaNegocio } from "./convertirReseñas.js";

export const version: string = "0.0.0";

export { convertirReseñas };
export type { ReseñaNegocio };