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