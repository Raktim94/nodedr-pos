import { test } from "node:test";
import assert from "node:assert/strict";
import { can, isAdmin, isFranchisor } from "../lib/perm.ts";
import { currencySymbolOf, formatMoney, round2 } from "../lib/format.ts";
import type { AuthUser } from "../lib/types.ts";

const user = (role: string, permissions: string[] = []) => ({ id: 1, name: "u", email: "u@x.test", role, permissions }) as unknown as AuthUser;

test("roles: admin everything, franchisor read-only reports, staff only what was granted", () => {
  assert.equal(can(user("admin"), "returns"), true);
  assert.equal(can(user("franchisor"), "reports"), true);
  assert.equal(can(user("franchisor"), "returns"), false);
  assert.equal(can(user("cashier", ["discount"]), "discount"), true);
  assert.equal(can(user("cashier", ["discount"]), "returns"), false);
  assert.equal(can(undefined, "reports"), false);
  assert.deepEqual([isAdmin(user("admin")), isAdmin(user("cashier")), isAdmin(undefined)], [true, false, false]);
  assert.deepEqual([isFranchisor(user("franchisor")), isFranchisor(user("admin"))], [true, false]);
});

test("money: symbol first, two decimals, bad numbers show as zero, default symbol when unset", () => {
  assert.equal(formatMoney(1234.5, "€"), "€ 1234.50");
  assert.equal(formatMoney(Number.NaN, "€"), "€ 0.00");
  assert.equal(formatMoney(2), "Rs. 2.00");
  assert.equal(currencySymbolOf(undefined), "Rs.");
  assert.equal(currencySymbolOf({ currencySymbol: "" }), "Rs.");
  assert.equal(currencySymbolOf({ currencySymbol: "$" }), "$");
  assert.equal(round2(1.005 + 1e-9), 1.01);
});
