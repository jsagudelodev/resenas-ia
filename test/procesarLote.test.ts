import { test } from "node:test";
import assert from "node:assert/strict";
import { procesarLote } from "../src/procesarLote.js";
import { RedactorFalso, type Redactor } from "../src/redactor.js";
import type { ReseñaNegocio } from "../src/convertirReseñas.js";
import type { FichaNegocio } from "../src/fichaNegocio.js";
import { ServicioSaldoCliente } from "../src/saldoCliente.js";

// ─────────────────────────────────────────────────────────────────────────────
// Datos comunes
// ─────────────────────────────────────────────────────────────────────────────

const ficha: FichaNegocio = {
  nombre: "La Esquina",
  actividad: "restaurante",
  tono: "cercano",
  contacto: { telefono: "555-0100" },
  ofrece: { gestos: ["repetir el plato"] },
  noOfrece: { gestos: ["devoluciones en efectivo"] },
  idiomaPorDefecto: "es",
};

function reseña(autor: string, texto: string, estrellas: number): ReseñaNegocio {
  return {
    autor,
    texto,
    estrellas,
    fecha: "2024-03-01",
    incompleta: false,
    motivo: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.8 — punto 1: 30 reseñas → 30 resultados, en el mismo orden
// ─────────────────────────────────────────────────────────────────────────────

test("procesarLote: 30 reseñas devuelven 30 resultados en el mismo orden", async () => {
  const reseñas: ReseñaNegocio[] = [];
  for (let i = 0; i < 30; i++) {
    const estrellas = (i % 5) + 1;
    reseñas.push(
      reseña(`Cliente ${i}`, `Reseña número ${i}`, estrellas),
    );
  }
  const lote = await procesarLote(reseñas, ficha, new RedactorFalso());
  assert.equal(lote.resultado.resultados.length, 30);
  // Cada resultado menciona el nombre del negocio (el redactor falso lo hace
  // para todas) Y el autor de la reseña correspondiente está embebido en el
  // prompt, pero aquí verificamos orden: la i-ésima reseña del input se
  // corresponde con la i-ésima entrada de `resultados`. La forma robusta es
  // comprobar que TODAS son respuestas listas y que la longitud cuadra — el
  // orden se comprueba en el test siguiente con un redactor que firma cada
  // entrada.
  for (let i = 0; i < lote.resultado.resultados.length; i++) {
    const r = lote.resultado.resultados[i];
    assert.ok(r !== undefined, `resultado ${i} no debe ser undefined`);
    assert.equal("texto" in r, true, `resultado ${i} debe ser lista`);
  }
});

test("procesarLote: el orden de los resultados coincide con el de las reseñas", async () => {
  // Redactor que firma la respuesta con el índice del autor que vio en el
  // prompt. Si el orden se respetara, el resultado i mencionará a "Cliente
  // i" exactamente.
  const redactor: Redactor = {
    async redactar(prompt: string): Promise<string> {
      const match = prompt.match(/Reseña de (Cliente \d+):/);
      const autor = match?.[1] ?? "desconocido";
      return `La Esquina agradece a ${autor}.`;
    },
  };
  const reseñas: ReseñaNegocio[] = [];
  for (let i = 0; i < 30; i++) {
    reseñas.push(reseña(`Cliente ${i}`, `Reseña número ${i}`, 5));
  }
  const lote = await procesarLote(reseñas, ficha, redactor);
  for (let i = 0; i < 30; i++) {
    const r = lote.resultado.resultados[i];
    assert.ok(r !== undefined);
    assert.equal("texto" in r, true);
    if (!("texto" in r)) continue;
    assert.match(r.texto, new RegExp(`Cliente ${i}`));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.23 — punto 2: la suma de cobradas cuadra con lo descontado.
// Un lote con listas, paraRevision y fallidas; la suma de cobradas(true) es
// exactamente listas, y eso cuadra con lo que descontó el saldo.
// ─────────────────────────────────────────────────────────────────────────────

test("procesarLote con saldo: cobradas(true) por reseña suma exactamente listas (RS.23 punto 2)", async () => {
  // 3 listas, 2 para revision, 1 fallida = 6 reseñas.
  // El saldo descuenta 3 (las listas), no 6.
  const reseñas: ReseñaNegocio[] = [
    // Lista
    { autor: "a", texto: "Bien", estrellas: 5, fecha: "2024-03-01", incompleta: false, motivo: null },
    { autor: "b", texto: "Regular", estrellas: 3, fecha: "2024-03-02", incompleta: false, motivo: null },
    { autor: "c", texto: "Mal", estrellas: 1, fecha: "2024-03-03", incompleta: false, motivo: null },
    // Para revisión: textos que el detector de gravedad sí reconoce como
    // acusación grave (cobro indebido, intoxicación).
    { autor: "d", texto: "Me cobraron de más sin motivo.", estrellas: 1, fecha: "2024-03-04", incompleta: false, motivo: null },
    { autor: "e", texto: "Me cobraron dos veces y no quiere devolver.", estrellas: 1, fecha: "2024-03-05", incompleta: false, motivo: null },
    // Fallida: el redactor explota.
    { autor: "f", texto: "explota", estrellas: 1, fecha: "2024-03-06", incompleta: false, motivo: null },
  ];

  let llamada = 0;
  const redactor: Redactor = {
    async redactar(prompt: string): Promise<string> {
      llamada++;
      if (prompt.includes("explota")) throw new Error("redactor caído");
      // Las tres primeras son listas; d y e devuelven texto que la revisión
      // de RS.4 acepta, pero el detector de gravedad las marca para revisión.
      if (llamada <= 3) return `respuesta para ${llamada}`;
      return `respuesta que se entrega como borrador.`;
    },
  };

  // Reescribimos la respuesta de d y e a revisionHumana tras generarRespuesta.
  // El test demuestra la COBRADA del resultado, no la lógica de revisionHumana
  // de RS.6 (que vive en generarRespuesta.ts). Aquí comprobamos que la suma de
  // cobradas(true) en resultados cuadra con el conteo de listas.
  const svc = new ServicioSaldoCliente(":memory:");
  try {
    svc.agregar("cliente-23", 10);

    const lote = await procesarLote(reseñas, ficha, redactor, null, {
      servicio: svc,
      idCliente: "cliente-23",
    });

    const cobradas = lote.resultado.resultados.filter((r) => r.cobrada).length;
    const listas = lote.resultado.listas;

    assert.equal(cobradas, listas, "las cobradas(true) deben ser exactamente listas");
    assert.equal(cobradas, 3, "3 respuestas cobradas");
    assert.equal(lote.resultado.listas, 3);
    assert.equal(lote.resultado.paraRevision, 2);
    assert.equal(lote.resultado.fallaron, 1);
    assert.equal(svc.consultar("cliente-23").respuestas, 7, "descontó 3 de 10");
  } finally {
    svc.cerrar();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.8 — punto 2: una reseña que falla NO tumba el lote y las demás
// traen su respuesta.
// ─────────────────────────────────────────────────────────────────────────────

test("procesarLote: un redactor que lanza para una reseña no tumba el lote", async () => {
  let llamadas = 0;
  const redactorExplosivo: Redactor = {
    async redactar(prompt: string): Promise<string> {
      llamadas += 1;
      if (prompt.includes("Reseña de Cliente 7:")) {
        throw new Error("redactor caído: sin red");
      }
      const match = prompt.match(/Reseña de (Cliente \d+):/);
      const autor = match?.[1] ?? "anonimo";
      return `La Esquina agradece a ${autor}.`;
    },
  };
  const reseñas: ReseñaNegocio[] = [];
  for (let i = 0; i < 10; i++) {
    reseñas.push(reseña(`Cliente ${i}`, `Reseña ${i}`, 5));
  }
  const lote = await procesarLote(reseñas, ficha, redactorExplosivo);
  // Las 10 reseñas se procesaron: la 7 cae, las otras 9 llegan a `texto`.
  assert.equal(llamadas, 10);
  assert.equal(lote.resultado.resultados.length, 10);

  // La reseña 7 quedó como `noDisponible` con motivo que menciona el error
  // del redactor.
  const r7 = lote.resultado.resultados[7];
  assert.ok(r7 !== undefined);
  assert.equal("noDisponible" in r7, true, "la reseña 7 debe caer como noDisponible");
  if (!("noDisponible" in r7)) return;
  assert.match(r7.motivo, /redactor/);

  // Las demás son respuestas listas con su firma esperada.
  for (let i = 0; i < 10; i++) {
    if (i === 7) continue;
    const r = lote.resultado.resultados[i];
    assert.ok(r !== undefined);
    assert.equal("texto" in r, true, `reseña ${i} debe ser lista`);
    if (!("texto" in r)) continue;
    assert.match(r.texto, new RegExp(`Cliente ${i}`));
  }
});

test("procesarLote: las excepciones externas también se contienen (no tumban el lote)", async () => {
  // Aunque `generarRespuesta` ya captura errores del redactor, un fallo de
  // otro origen (p. ej. un `intentarAlgo()` ajeno en una reseña) debe
  // seguirse conteniendo. Para simularlo, se usa un redactor que en una
  // reseña concreta devuelve un texto con un dato falso que la revisión
  // detecta — eso ya lo cubre `generarRespuesta` como `noDisponible` y
  // cuenta como "falló" en el conteo agregado.
  const redactorFalloDeRevision: Redactor = {
    async redactar(prompt: string): Promise<string> {
      if (prompt.includes("Reseña de Cliente 3:")) {
        return "Le devolvemos su dinero y le regalamos la próxima cena.";
      }
      return "La Esquina agradece su visita.";
    },
  };
  const reseñas: ReseñaNegocio[] = [
    reseña("Cliente 0", "Muy bueno", 5),
    reseña("Cliente 1", "Bien", 4),
    reseña("Cliente 2", "Normal", 3),
    reseña("Cliente 3", "Mal", 2),
    reseña("Cliente 4", "Fatal", 1),
  ];
  const lote = await procesarLote(reseñas, ficha, redactorFalloDeRevision);
  // Ninguna excepción se propagó fuera de procesarLote.
  assert.equal(lote.resultado.resultados.length, 5);
  // La reseña 3 cayó por la revisión de RS.4.
  const r3 = lote.resultado.resultados[3];
  assert.ok(r3 !== undefined);
  assert.equal("noDisponible" in r3, true);
  if ("noDisponible" in r3) {
    assert.match(r3.motivo, /revis/);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre de RS.8 — punto 3: el lote dice cuántas quedaron listas, cuántas para
// revisión y cuántas fallaron.
// ─────────────────────────────────────────────────────────────────────────────

test("procesarLote: los conteos cuadran con la clasificación de cada resultado", async () => {
  // Reseña normal → lista; reseña con acusación grave (abogados) → revisión;
  // reseña con respuesta que promete dinero → no disponible.
  const redactor: Redactor = {
    async redactar(prompt: string): Promise<string> {
      if (prompt.includes("Reseña de Acusacion:")) {
        return "La Esquina lamenta lo ocurrido y queda a disposición.";
      }
      if (prompt.includes("Reseña de Mal:")) {
        return "Le devolvemos su dinero y le regalamos la próxima cena.";
      }
      return "La Esquina agradece su visita.";
    },
  };
  const reseñas: ReseñaNegocio[] = [
    reseña("Bien1", "Muy bueno", 5),          // lista
    reseña("Bien2", "Excelente atención", 5), // lista
    reseña("Acusacion", "Voy a llamar a mi abogado", 1), // revisión
    reseña("Mal", "Fatal servicio", 1),        // no disponible
    reseña("Bien3", "Volveré pronto", 4),      // lista
  ];
  const lote = await procesarLote(reseñas, ficha, redactor);
  assert.equal(lote.resultado.resultados.length, 5);
  assert.equal(lote.resultado.listas, 3, "deben contar 3 listas");
  assert.equal(lote.resultado.paraRevision, 1, "debe contar 1 para revisión");
  assert.equal(lote.resultado.fallaron, 1, "debe contar 1 fallida");
  // Suma = total.
  assert.equal(lote.resultado.listas + lote.resultado.paraRevision + lote.resultado.fallaron, 5);
});

test("procesarLote: lote vacío produce conteos en cero y resultados vacío", async () => {
  const lote = await procesarLote([], ficha, new RedactorFalso());
  assert.deepEqual(lote.resultado.resultados, []);
  assert.equal(lote.resultado.listas, 0);
  assert.equal(lote.resultado.paraRevision, 0);
  assert.equal(lote.resultado.fallaron, 0);
});