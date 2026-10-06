const crypto = require('crypto');

// Plaintext keys look like "nk_live_<64 hex chars>" — a recognisable prefix
// (same idea as GitHub/Stripe tokens) plus 32 random bytes. Only the SHA-256
// hash of the full key is ever persisted (ApiKey.keyHash); the plaintext is
// shown to the admin exactly once, at creation time, and never again.
const KEY_PREFIX = 'nk_live_';

function generateApiKey() {
  const random = crypto.randomBytes(32).toString('hex');
  const plaintext = `${KEY_PREFIX}${random}`;
  return {
    plaintext,
    // Shown in the admin's key list so they can tell keys apart without
    // ever re-displaying the secret — first 8 chars of the random part.
    keyPrefix: random.slice(0, 8),
    keyHash: hashApiKey(plaintext),
  };
}

function hashApiKey(plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

function generateWebhookSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// Capabilities a key can be granted — least privilege by default.
const SCOPES = ['products:read', 'stock:write', 'bills:write', 'bills:read', 'warranty:read', 'orders:write'];

function parseScopes(csv) {
  return String(csv || '').split(',').map((s) => s.trim()).filter((s) => SCOPES.includes(s));
}

module.exports = {
  SCOPES,
  parseScopes, generateApiKey, hashApiKey, generateWebhookSecret, KEY_PREFIX };
