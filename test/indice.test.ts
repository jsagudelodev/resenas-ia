import { test } from "node:test";
import assert from "node:assert/strict";
import { version, convertirReseñas } from "../src/indice.js";

test("el módulo raíz expone una versión en formato semver", () => {
  assert.equal(typeof version, "string");
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test("el módulo raíz reexporta convertirReseñas", () => {
  assert.equal(typeof convertirReseñas, "function");
});

test("convertirReseñas sigue sin estar implementado (pertenece a RS.1)", () => {
  assert.throws(() => convertirReseñas("texto-de-ejemplo"), /RS\.1/);
});