// RS.13 — Ni un nombre de reseñador en el log.
//
// El cierre tiene dos puntos:
//   (1) un test procesa un lote con una credencial configurada y comprueba
//       que ni la credencial ni el nombre de ningún reseñador aparecen en
//       ninguna línea del log;
//   (2) para que el test pruebe algo, el dato tiene que llegar de verdad
//       al camino que escribe el log. Eso se garantiza aquí con dos
//       detalles de montaje:
//       - la credencial y los autores se cuelgan del propio `RegistradorSeguro`
//         como `sensibles`, de manera que cualquier cadena coincidente que el
//         `RegistradorDePrueba` subyacente registre queda reemplazada por
//         `[REDACTED]` antes de salir;
//       - y el lote pasa por `procesarLote(..., regs)`, que es el camino
//         real por el que el log recibe los eventos (RS.8/RS.3). Si el
//         test sustituyera el log por un espía en la cima del llamador,
//         no probaría nada de lo que pide el cierre.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validarFicha, type FichaNegocio } from "../src/fichaNegocio.js";
import {
  convertirReseñas,
  type ReseñaNegocio,
} from "../src/convertirReseñas.js";
import { procesarLote } from "../src/procesarLote.js";
import { RedactorFalso } from "../src/redactor.js";
import {
  listaDeSaneamientoDeLote,
  ocultarCadenas,
  RegistradorDePrueba,
  RegistradorSeguro,
  type Evento,
} from "../src/registro.js";

const fichaCompleta: FichaNegocio = {
  nombre: "La Esquina",
  actividad: "restaurante",
  tono: "cercano",
  contacto: { telefono: "555-0100", correo: "hola@laesquina.test" },
  ofrece: { gestos: ["repetir el plato", "invitar un café"] },
  noOfrece: { gestos: ["devoluciones en efectivo"] },
  idiomaPorDefecto: "es",
};

const CREDENCIAL = "sk-very-secret-abcdef-1234567890";

// Autores con nombres de personas reales: el producto no debe permitir
// que aparezcan en un log.
const AUTORES = ["María García", "Juan Pérez"];

function reseñasDelLote(): ReseñaNegocio[] {
  return [
    {
      autor: AUTORES[0] ?? "",
      texto: "Servicio impecable, volveré seguro.",
      estrellas: 5,
      fecha: "2025-09-01",
      incompleta: false,
      motivo: null,
    },
    {
      autor: AUTORES[1] ?? "",
      texto: "Tardaron 40 minutos en servirnos.",
      estrellas: 1,
      fecha: "2025-09-02",
      incompleta: false,
      motivo: null,
    },
  ];
}

test("ocultarCadenas reemplaza credenciales y nombres de autores", () => {
  const sensibles = [CREDENCIAL, ...AUTORES];
  const mensaje = `procesando con ${CREDENCIAL} para ${AUTORES[0]} y ${AUTORES[1]}`;
  const saneado = ocultarCadenas(mensaje, sensibles);
  assert.equal(saneado.includes(CREDENCIAL), false);
  assert.equal(saneado.includes(AUTORES[0] ?? ""), false);
  assert.equal(saneado.includes(AUTORES[1] ?? ""), false);
  // El resto del mensaje sigue ahí.
  assert.equal(saneado.startsWith("procesando con [REDACTED] para [REDACTED] y [REDACTED]"), true);
});

test("listaDeSaneamientoDeLote recoge autores y la credencial", () => {
  const lista = listaDeSaneamientoDeLote(
    [...AUTORES, "  ", ""],
    CREDENCIAL,
  );
  assert.ok(lista.sensibles.includes(AUTORES[0] ?? ""));
  assert.ok(lista.sensibles.includes(AUTORES[1] ?? ""));
  assert.ok(lista.sensibles.includes(CREDENCIAL));
  // Vacíos y blancos no se incluyen.
  assert.equal(lista.sensibles.includes(""), false);
  assert.equal(lista.sensibles.includes("  "), false);
});

test("procesarLote con RegistradorSeguro no filtra credencial ni autores al log", async () => {
  const reseñas = reseñasDelLote();
  const autores = reseñas.map((r) => r.autor);
  const lista = listaDeSaneamientoDeLote(autores, CREDENCIAL);
  const buffer = new RegistradorDePrueba();
  const regs = new RegistradorSeguro(buffer, lista);
  const ficha = validarFicha(fichaCompleta);
  assert.equal(ficha.ok, true);
  if (!ficha.ok) return;
  const redactor = new RedactorFalso();

  const lote = await procesarLote(reseñas, ficha.ficha, redactor, regs);

  // El lote procesa las dos reseñas (punto 2: el dato tiene que entrar al
  // log por el camino real, no por un espía externo).
  assert.equal(lote.resultados.length, 2);

  // El buffer tiene al menos un evento por reseña: 2 de "procesando
  // reseña N" y 2 de "redactando respuesta para reseña del autor".
  const lineas = buffer.aLineas();
  assert.ok(lineas.length >= 4, `el log debería tener al menos 4 líneas; tiene ${lineas.length}`);

  // Punto 1 del cierre: ni la credencial ni el nombre de ningún reseñador
  // pueden aparecer en NINGUNA línea.
  for (const linea of lineas) {
    assert.equal(
      linea.includes(CREDENCIAL),
      false,
      `la credencial no debe aparecer en el log: ${linea}`,
    );
    for (const autor of autores) {
      assert.equal(
        autor.trim().length === 0 ? true : !linea.includes(autor),
        true,
        `el nombre del reseñador "${autor}" no debe aparecer en el log: ${linea}`,
      );
    }
  }
});

test("RegistradorSeguro oculta credenciales en campos string del contexto", () => {
  const buffer = new RegistradorDePrueba();
  const regs = new RegistradorSeguro(
    buffer,
    { sensibles: [CREDENCIAL] },
  );
  const evento: Evento = {
    nivel: "info",
    mensaje: "petición al proveedor",
    contexto: {
      endpoint: "https://api.proveedor.test/v1/responder",
      headers: { "x-api-key": CREDENCIAL, "x-traza": "abc-123" },
      intentos: 1,
    },
  };
  regs.registrar(evento);
  const linea = buffer.aLineas()[0];
  assert.ok(linea !== undefined);
  assert.equal(linea.includes(CREDENCIAL), false);
  // El endpoint y la otra cabecera sí pueden aparecer.
  assert.equal(linea.includes("https://api.proveedor.test/v1/responder"), true);
  assert.equal(linea.includes("x-traza"), true);
});

test("RegistradorSeguro con lista vacía no oculta nada", () => {
  const buffer = new RegistradorDePrueba();
  const regs = new RegistradorSeguro(buffer, { sensibles: [] });
  regs.registrar({
    nivel: "info",
    mensaje: "mensaje neutro",
    contexto: { clave: CREDENCIAL },
  });
  const linea = buffer.aLineas()[0];
  assert.ok(linea !== undefined);
  assert.equal(linea.includes(CREDENCIAL), true);
});

test("RegistradorSeguro no rompe el lote cuando no hay sensibles que ocultar", async () => {
  // Camino de producción sin credencial configurada: la lista solo trae
  // autores, y el lote debe seguir entero.
  const reseñas = reseñasDelLote();
  const autores = reseñas.map((r) => r.autor);
  const lista = listaDeSaneamientoDeLote(autores, null);
  const buffer = new RegistradorDePrueba();
  const regs = new RegistradorSeguro(buffer, lista);
  const ficha = validarFicha(fichaCompleta);
  assert.equal(ficha.ok, true);
  if (!ficha.ok) return;
  const lote = await procesarLote(
    reseñas,
    ficha.ficha,
    new RedactorFalso(),
    regs,
  );
  assert.equal(lote.resultados.length, 2);
  assert.ok(buffer.Eventos.length >= 4);
});

test("ocultarCadenas ordena por longitud y no deja fragmentos visibles", () => {
  // Si la más corta se ocultara primero, el fragmento de la larga
  // quedaría como [REDACTED]DEF en el log, que sigue siendo parte de la
  // credencial. La implementación ordena por longitud descendente.
  const sensibles = ["sk-", "sk-very-secret"];
  const texto = "cabecera sk-very-secret-final";
  const sano = ocultarCadenas(texto, sensibles);
  assert.equal(sano.includes("sk-very-secret"), false);
  assert.equal(sano.includes("sk-"), false);
  assert.equal(sano, "cabecera [REDACTED]-final");
});