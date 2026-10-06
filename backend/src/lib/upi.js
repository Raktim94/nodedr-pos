// UPI deep link per the NPCI spec. Scanning the QR (or tapping the link)
// opens any UPI app pre-filled with the exact payee and amount.
function buildUpiUri({ vpa, name, amount, note, ref }) {
  const q = new URLSearchParams();
  q.set('pa', vpa);
  if (name) q.set('pn', name.slice(0, 60));
  if (amount > 0) q.set('am', Number(amount).toFixed(2));
  q.set('cu', 'INR');
  if (note) q.set('tn', note.slice(0, 60));
  if (ref) q.set('tr', String(ref).slice(0, 35));
  // URLSearchParams encodes spaces as '+'; UPI apps expect %20.
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}

module.exports = { buildUpiUri };
