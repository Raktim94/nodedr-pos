// Online product lookup for the "Find online" catalog helper.
//
// Data comes from the Open Food Facts family of free, key-less, community
// databases (https://world.openfoodfacts.org and its siblings for beauty and
// general goods). They are queried from the server — never the browser — so
// there is no CORS/CSP exposure and the shop's staff never talk to a third
// party directly. Results are only ever *suggestions*: nothing is written to
// the catalog until a user reviews and saves them in the product form.
const SOURCES = [
  { id: 'food', label: 'Open Food Facts', host: 'world.openfoodfacts.org' },
  { id: 'beauty', label: 'Open Beauty Facts', host: 'world.openbeautyfacts.org' },
  { id: 'products', label: 'Open Products Facts', host: 'world.openproductsfacts.org' },
];
const FIELDS = 'code,product_name,generic_name,brands,categories,quantity,image_front_small_url';
const TIMEOUT_MS = 6000;
const MAX_RESULTS = 20;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const USER_AGENT = 'nodedr-pos/1.x (https://github.com/Raktim94/nodedr-pos)';

const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

// 6–14 digits is a barcode (EAN-8, UPC-A, EAN-13, GTIN-14); anything else is a name.
function detectMode(q) {
  return /^\d{6,14}$/.test(q) ? 'barcode' : 'name';
}

function normalize(p, source) {
  const name = String(p.product_name || p.generic_name || '').trim();
  const barcode = String(p.code || '').trim();
  if (!name || !barcode) return null; // unusable as a catalog entry
  const brand = String(p.brands || '').split(',')[0].trim();
  const category = String(p.categories || '').split(',')[0].trim();
  return {
    barcode,
    name: name.slice(0, 200),
    brand: brand || null,
    category: category.replace(/^[a-z]{2}:/i, '').slice(0, 80) || null,
    quantity: String(p.quantity || '').trim().slice(0, 40) || null,
    imageUrl: /^https:\/\//.test(p.image_front_small_url || '') ? p.image_front_small_url : null,
    source: source.label,
  };
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function queryOne(source, q, mode, fetchImpl) {
  if (mode === 'barcode') {
    const data = await getJson(`https://${source.host}/api/v2/product/${encodeURIComponent(q)}.json?fields=${FIELDS}`, fetchImpl);
    // status 0 / missing product = "not in this database", not an error.
    return data && data.status === 1 && data.product ? [normalize({ code: q, ...data.product }, source)] : [];
  }
  const url =
    `https://${source.host}/cgi/search.pl?search_terms=${encodeURIComponent(q)}` +
    `&search_simple=1&action=process&json=1&page_size=${MAX_RESULTS}&fields=${FIELDS}`;
  const data = await getJson(url, fetchImpl);
  return (data.products || []).map((p) => normalize(p, source));
}

/**
 * @returns {{ mode, results: object[], warnings: string[] }}
 * Throws an Error with `.status` 400 (bad query) or 502 (every source failed).
 */
async function lookupProducts(rawQuery, { fetchImpl = fetch } = {}) {
  const q = String(rawQuery || '').trim();
  if (q.length < 2) throw Object.assign(new Error('Type at least 2 characters to search'), { status: 400 });
  if (q.length > 100) throw Object.assign(new Error('Search text is too long'), { status: 400 });

  const mode = detectMode(q);
  const key = `${mode}:${q.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const settled = await Promise.allSettled(SOURCES.map((s) => queryOne(s, q, mode, fetchImpl)));
  const failed = settled.filter((r) => r.status === 'rejected').length;
  if (failed === SOURCES.length) {
    throw Object.assign(
      new Error('The online product database could not be reached. Check the internet connection and try again, or enter the product manually.'),
      { status: 502 }
    );
  }

  const seen = new Set();
  const results = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value) {
      if (!item || seen.has(item.barcode)) continue;
      seen.add(item.barcode);
      results.push(item);
    }
  }
  const warnings = failed ? [`${failed} of ${SOURCES.length} product databases did not respond — results may be incomplete.`] : [];
  const out = { mode, results: results.slice(0, MAX_RESULTS), warnings };
  // Don't cache partial answers: a retry should be able to complete them.
  if (!failed) cacheSet(key, out);
  return out;
}

module.exports = { lookupProducts, detectMode, normalize, _clearCache: () => cache.clear() };
