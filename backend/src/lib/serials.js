// Serial / IMEI helpers shared by checkout, returns, the inventory routes,
// the External API and MCP.
const IMEI_RE = /^\d{15}$/;

function normalizeSerial(s) {
  return String(s).trim().toUpperCase().replace(/\s+/g, '');
}

// Luhn check for 15-digit IMEIs. Only applied when the value looks like an
// IMEI; arbitrary serial numbers (laptops, appliances) are not Luhn-valid.
function imeiLuhnOk(imei) {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(imei[14 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function validateSerial(raw) {
  const serial = normalizeSerial(raw);
  if (serial.length < 4 || serial.length > 64) return { ok: false, error: `Serial "${raw}" must be 4–64 characters` };
  if (IMEI_RE.test(serial) && !imeiLuhnOk(serial)) return { ok: false, error: `"${serial}" is not a valid IMEI (checksum failed)` };
  return { ok: true, serial };
}

function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0); // clamp 31 Jan + 1 month -> 28/29 Feb
  return d;
}

function warrantyStatus(unit, now = new Date()) {
  if (unit.status === 'IN_STOCK') return 'NOT_SOLD';
  if (!unit.warrantyEndsAt) return 'NO_WARRANTY';
  return new Date(unit.warrantyEndsAt) >= now ? 'ACTIVE' : 'EXPIRED';
}

module.exports = { normalizeSerial, validateSerial, addMonths, warrantyStatus };
