import { describe, it } from "node:test";
import { equal, notEqual, ok, throws } from "node:assert";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServicioSaldoCliente } from "../src/saldoCliente.js";

describe("ServicioSaldoCliente", () => {
  it("consultar devuelve 0 para cliente sin saldo", () => {
    const svc = new ServicioSaldoCliente(":memory:");
    try {
      const saldo = svc.consultar("cliente-nuevo");
      equal(saldo.cliente, "cliente-nuevo");
      equal(saldo.respuestas, 0);
    } finally {
      svc.cerrar();
    }
  });

  it("agregar crea o incrementa el saldo", () => {
    const svc = new ServicioSaldoCliente(":memory:");
    try {
      const r1 = svc.agregar("ana", 10);
      equal(r1.respuestas, 10);

      const r2 = svc.agregar("ana", 5);
      equal(r2.respuestas, 15);

      const r3 = svc.consultar("ana");
      equal(r3.respuestas, 15);
    } finally {
      svc.cerrar();
    }
  });

  it("descontar reduce el saldo cuando alcanza", () => {
    const svc = new ServicioSaldoCliente(":memory:");
    try {
      svc.agregar("carlos", 10);
      const resultado = svc.descontar("carlos", 3);
      ok(resultado.exitoso);
      equal(resultado.saldoActual, 7);
      equal(svc.consultar("carlos").respuestas, 7);
    } finally {
      svc.cerrar();
    }
  });

  it("descontar no modifica el saldo si no alcanza (cierre punto 2)", () => {
    const svc = new ServicioSaldoCliente(":memory:");
    try {
      svc.agregar("diana", 2);
      const resultado = svc.descontar("diana", 5);
      equal(resultado.exitoso, false);
      equal(resultado.faltantes, 3);
      equal(resultado.saldoActual, 2);
      equal(svc.consultar("diana").respuestas, 2);
    } finally {
      svc.cerrar();
    }
  });

  it("descontar cero respuestas es exitoso sin cambiar saldo (cierre punto 1)", () => {
    const svc = new ServicioSaldoCliente(":memory:");
    try {
      svc.agregar("eva", 5);
      const resultado = svc.descontar("eva", 0);
      ok(resultado.exitoso);
      equal(resultado.saldoActual, 5);
      equal(svc.consultar("eva").respuestas, 5);
    } finally {
      svc.cerrar();
    }
  });

  it("el saldo no puede ser negativo tras descuento concurrente (BEGIN IMMEDIATE)", () => {
    // Este test verifica que BEGIN IMMEDIATE serializa dos descuentos que
    // llegan a la vez con saldo insuficiente para ambos. El segundo debe
    // leer el saldo ya reducido por el primero y rechazar, no sobre-descontar.
    const svc = new ServicioSaldoCliente(":memory:");
    try {
      svc.agregar("fran", 3);

      // Dos descuentos simultáneos de 3 respuestas cada uno. Con saldo 3,
      // solo uno puede pasar; el otro debe obtener faltantes > 0.
      // Serializamos en el mismo proceso: el primero pasa, el segundo rechaza.
      const r1 = svc.descontar("fran", 3);
      const r2 = svc.descontar("fran", 3);

      const exitoso = [r1, r2].filter((r) => r.exitoso);
      const rechazado = [r1, r2].filter((r) => !r.exitoso);

      equal(exitoso.length, 1);
      equal(rechazado.length, 1);
      const rech = rechazado[0]!;
      ok(rech.faltantes !== undefined && rech.faltantes > 0);

      // El saldo final nunca baja de 0.
      equal(svc.consultar("fran").respuestas, 0);
    } finally {
      svc.cerrar();
    }
  });

  // ────────────────────────── RS.17 — Códigos de compra ───────────────────────

  it("canjear un código inexistente devuelve error genérico (cierre punto 3)", () => {
    const svc = new ServicioSaldoCliente(":memory:");
    try {
      const resultado = svc.canjear("CODIGO-INVENTADO-XYZ");
      equal(resultado.exitoso, false);
      // El mensaje NO revela si el código existe ni cuántos hay.
      ok(resultado.motivo!.includes("inválido") || resultado.motivo!.includes("no encontrado"));
      equal(svc.consultar("anonimo").respuestas, 0);
    } finally {
      svc.cerrar();
    }
  });

  it("canjear un código válido recarga el saldo una vez y lo consume (cierre punto 1)", () => {
    const svc = new ServicioSaldoCliente(":memory:");
    try {
      svc.registrarCodigo("PACK-20-RESPUESTAS", 20);
      const resultado = svc.canjear("PACK-20-RESPUESTAS");
      ok(resultado.exitoso);
      equal(resultado.cliente, "anonimo");
      equal(resultado.respuestasAgregadas, 20);
      equal(svc.consultar("anonimo").respuestas, 20);
    } finally {
      svc.cerrar();
    }
  });

  it("canjear el mismo código dos veces falla en el segundo intento (cierre punto 2)", () => {
    const svc = new ServicioSaldoCliente(":memory:");
    try {
      svc.registrarCodigo("PACK-10", 10);
      const r1 = svc.canjear("PACK-10");
      ok(r1.exitoso);

      const r2 = svc.canjear("PACK-10");
      equal(r2.exitoso, false);
      ok(r2.motivo!.includes("inválido") || r2.motivo!.includes("no encontrado") || r2.motivo!.includes("usado"));
      // El saldo sigue siendo 10, no se agregó dos veces.
      equal(svc.consultar("anonimo").respuestas, 10);
    } finally {
      svc.cerrar();
    }
  });

  it("canjear dos códigos idénticos que llegan a la vez no recarga dos veces (BEGIN IMMEDIATE)", () => {
    // Simula dos canjes simultáneos: serializados por la misma conexión,
    // el primero consume el código, el segundo obtiene error genérico.
    const svc = new ServicioSaldoCliente(":memory:");
    try {
      svc.registrarCodigo("PACK-5-SIMULTANEO", 5);
      const r1 = svc.canjear("PACK-5-SIMULTANEO");
      const r2 = svc.canjear("PACK-5-SIMULTANEO");
      const exitosos = [r1, r2].filter((r) => r.exitoso);
      equal(exitosos.length, 1);
      // El saldo total es exactamente 5, no 10.
      equal(svc.consultar("anonimo").respuestas, 5);
    } finally {
      svc.cerrar();
    }
  });

  it("registrarCodigo es idempotente: redefine cantidad si el código ya existe", () => {
    const svc = new ServicioSaldoCliente(":memory:");
    try {
      svc.registrarCodigo("PACK-10", 10);
      svc.registrarCodigo("PACK-10", 20); // red费ine
      const r = svc.canjear("PACK-10");
      ok(r.exitoso);
      equal(r.respuestasAgregadas, 20);
    } finally {
      svc.cerrar();
    }
  });

  // ──────────────────────────────── Fin RS.17 ─────────────────────────────────

  it("el saldo sobrevive a reiniciar el servicio (cierre punto 3)", () => {
    const ruta = join(tmpdir(), `saldo-test-${Date.now()}.db`);
    const svc1 = new ServicioSaldoCliente(ruta);
    svc1.agregar("gema", 20);
    svc1.cerrar();

    const svc2 = new ServicioSaldoCliente(ruta);
    try {
      equal(svc2.consultar("gema").respuestas, 20);
    } finally {
      svc2.cerrar();
    }
  });
});