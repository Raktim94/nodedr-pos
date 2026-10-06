const { z } = require('zod');

// Quantities may be fractional (kg, litres from a scale) up to 3 decimals.
// Serial/IMEI-tracked products are additionally forced to whole units where
// the serial list length is checked against the quantity.
const qtySchema = z
  .number()
  .positive()
  .max(1_000_000)
  .refine((n) => Math.abs(Math.round(n * 1000) / 1000 - n) < 1e-9, { message: 'At most 3 decimal places' });

const r3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

module.exports = { qtySchema, r3 };
