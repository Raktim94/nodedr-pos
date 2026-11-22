// Origin that links handed to customers and integrations point back to.
const publicBaseUrl = (req) => process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

// An Error that carries the HTTP status routes answer with.
const httpError = (message, status = 400) => Object.assign(new Error(message), { status });

module.exports = { publicBaseUrl, httpError };
