import { test } from "node:test";
import assert from "node:assert/strict";
import { verifactuAvailable } from "../lib/region.ts";

test("VERI*FACTU is offered to euro shops only", () => {
  assert.equal(verifactuAvailable({ currencyCode: "EUR" }), true);
  assert.equal(verifactuAvailable({ currencyCode: "INR" }), false);
});
