const prisma = require('./prisma');

// ShopSettings is a single-row table; every reader goes through here so that
// assumption lives in one place. Pass a transaction client to read inside it.
const getSettings = (db = prisma) => db.shopSettings.findFirst();

module.exports = { getSettings };
