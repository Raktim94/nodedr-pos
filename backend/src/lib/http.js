// Origin that links handed to customers and integrations point back to.
const publicBaseUrl = (req) => process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

module.exports = { publicBaseUrl };
