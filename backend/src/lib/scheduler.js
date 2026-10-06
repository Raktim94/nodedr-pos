// A tiny in-process scheduler (no cron daemon, no extra service): wakes every
// few minutes, does a cheap settings read, and sends the sales summary e-mail
// when it's due. Daily reports go out after 08:00 local for the previous day;
// weekly ones on Monday after 08:00 for the previous Mon–Sun.
const prisma = require('./prisma');
const { totalsFor, overview, dayKey } = require('./reports');
const { sendMail } = require('./mailer');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function buildSummary(shop, start, end, label) {
  const to = dayKey(new Date(end.getTime() - 1));
  const o = await overview(dayKey(start), to);
  const sym = shop.currencySymbol;
  const m = (n) => `${sym} ${Number(n).toFixed(2)}`;
  const low = await prisma.product.findMany({ where: { stock: { lte: shop.lowStockAlert } }, orderBy: { stock: 'asc' }, take: 10 });
  const t = o.totals;
  const sign = (n) => `${n >= 0 ? '▲' : '▼'} ${Math.abs(n)}%`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#17251d">
  <h2 style="margin:0 0 4px">${esc(shop.shopName)} — ${esc(label)}</h2>
  <p style="color:#66746b;margin:0 0 16px">${esc(o.range.from)} → ${esc(o.range.to)}</p>
  <table style="width:100%;border-collapse:collapse">
    <tr><td>Revenue</td><td align="right"><b>${m(t.revenue)}</b> <small>${sign(o.deltas.revenue)}</small></td></tr>
    <tr><td>Gross profit</td><td align="right"><b>${m(t.grossProfit)}</b> <small>${t.marginPct}% margin</small></td></tr>
    <tr><td>Bills</td><td align="right"><b>${t.bills}</b> <small>${sign(o.deltas.bills)}</small></td></tr>
    <tr><td>Average bill</td><td align="right"><b>${m(t.avgBill)}</b></td></tr>
  </table>
  <h3>Top products</h3>
  <ol>${o.topProducts.slice(0, 5).map((p) => `<li>${esc(p.name)} — ${p.qty} sold, ${m(p.net)}</li>`).join('') || '<li>No sales</li>'}</ol>
  ${low.length ? `<h3>Low stock</h3><ul>${low.map((p) => `<li>${esc(p.name)} — ${p.stock} left</li>`).join('')}</ul>` : ''}
  </div>`;
  return { html, text: `${shop.shopName} ${label}: revenue ${m(t.revenue)}, profit ${m(t.grossProfit)}, bills ${t.bills}` };
}

async function sendReportNow(kind) {
  const shop = await prisma.shopSettings.findFirst();
  if (!shop?.reportEmail) throw Object.assign(new Error('Set a report e-mail address first'), { status: 409 });
  const now = new Date();
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start, end, label;
  if (kind === 'weekly') {
    end = new Date(sod);
    end.setDate(end.getDate() - ((sod.getDay() + 6) % 7)); // this Monday (exclusive end)
    start = new Date(end);
    start.setDate(start.getDate() - 7);
    label = 'Weekly sales summary';
  } else {
    end = sod;
    start = new Date(sod.getTime() - 86400000);
    label = 'Daily sales summary';
  }
  const { html, text } = await buildSummary(shop, start, end, label);
  await sendMail({ to: shop.reportEmail, subject: `${shop.shopName}: ${label}`, html, text });
}

async function tick() {
  try {
    const shop = await prisma.shopSettings.findFirst();
    if (!shop || shop.reportFrequency === 'off' || !shop.reportEmail || !shop.smtpConfigEnc) return;
    const now = new Date();
    if (now.getHours() < 8) return;
    const last = shop.reportLastSentAt;
    const sentToday = last && dayKey(last) === dayKey(now);
    if (sentToday) return;
    if (shop.reportFrequency === 'weekly' && now.getDay() !== 1) return;
    await sendReportNow(shop.reportFrequency);
    await prisma.shopSettings.update({ where: { id: shop.id }, data: { reportLastSentAt: now } });
  } catch (err) {
    console.error('scheduled report failed:', err.message);
  }
}

function startScheduler() {
  // unref(): never keep the process alive just for this timer.
  setInterval(tick, 10 * 60 * 1000).unref();
  setTimeout(tick, 60 * 1000).unref();
}

module.exports = { startScheduler, sendReportNow };
