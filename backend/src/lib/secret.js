const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET_PATH = path.join(__dirname, '..', '..', 'data', '.jwt-secret');

function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  if (fs.existsSync(SECRET_PATH)) {
    return fs.readFileSync(SECRET_PATH, 'utf8').trim();
  }

  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
  return secret;
}

module.exports = { getJwtSecret };
