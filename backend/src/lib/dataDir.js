const path = require('path');

// Where mutable data (database, signing secret, signatures, product images)
// lives. Docker/CasaOS/dev installs keep the historical `backend/data`
// location. The Windows Store edition sets NODEDR_DATA_DIR to a writable
// per-user folder, because its install directory is read-only.
const DATA_DIR = process.env.NODEDR_DATA_DIR
  ? path.resolve(process.env.NODEDR_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');

module.exports = { DATA_DIR };
