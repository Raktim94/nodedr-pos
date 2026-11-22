// SOAP client for AEAT's VERI*FACTU submission service (SistemaFacturacion.wsdl, operation
// RegFactuSistemaFacturacion). Authenticates with the taxpayer's qualified certificate over mutual TLS.
const https = require('node:https');
const forge = require('node-forge');
const { soap } = require('./domain');

// Endpoints from AEAT's WSDL for systems that issue verifiable invoices (personal-certificate hosts).
const AEAT_ENDPOINT = {
  TEST: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  PRODUCTION: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
};

class AeatFault extends Error {
  code;
  constructor(code, message) {
    super(`aeat: ${code}: ${message}`);
    this.code = code;
  }
}

/** Reads a .p12/.pfx and returns its subject and expiry; throws on a wrong password or a bad file. */
function inspectCertificate(p12, password) {
  try {
    const asn1 = forge.asn1.fromDer(p12.toString('binary'));
    const p = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
    const bags = p.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
    const key =
      (p.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [])
        .length + (p.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []).length;
    const cert = bags.map((b) => b.cert).find((c) => c);
    if (!cert || key === 0) throw new Error('no certificate with a private key found');
    const subject = cert.subject.attributes
      .map((a) => `${a.shortName ?? a.name}=${String(a.value)}`)
      .join(', ');
    return { subject, expiresAt: cert.validity.notAfter };
  } catch (e) {
    throw new Error(`Cannot read the certificate (wrong password or not a .p12/.pfx file): ${e.message}`);
  }
}

const tag = (xml, name) => {
  const m = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${name}>`
  ).exec(xml);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
};
const blocks = (xml, name) =>
  [
    ...xml.matchAll(
      new RegExp(`<(?:[A-Za-z0-9_]+:)?${name}(?:\\s[^>]*)?>[\\s\\S]*?</(?:[A-Za-z0-9_]+:)?${name}>`, 'g')
    ),
  ].map((m) => m[0]);

const unescapeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const snippet = (s) => {
  const t = s.split(/\s+/).join(' ');
  return t.length > 300 ? `${t.slice(0, 300)}…` : t;
};

function parseResponse(status, raw) {
  if (/Fault/.test(raw)) {
    const code = tag(raw, 'faultcode');
    const message = tag(raw, 'faultstring');
    if (code || message) throw new AeatFault(code, unescapeXml(message));
  }
  const state = tag(raw, 'EstadoEnvio');
  if (!state) {
    if (status >= 400) throw new Error(`aeat: HTTP ${status}: ${snippet(raw)}`);
    throw new Error(`aeat: unexpected response (HTTP ${status}): ${snippet(raw)}`);
  }
  const lines = blocks(raw, 'RespuestaLinea').map((b) => ({
    issuerNif: tag(b, 'IDEmisorFactura'),
    number: unescapeXml(tag(b, 'NumSerieFactura')),
    issueDate: tag(b, 'FechaExpedicionFactura'),
    operation: tag(b, 'TipoOperacion'),
    state: tag(b, 'EstadoRegistro'),
    errorCode: tag(b, 'CodigoErrorRegistro'),
    errorText: unescapeXml(tag(b, 'DescripcionErrorRegistro')),
  }));
  return {
    csv: tag(raw, 'CSV'),
    state,
    waitSeconds: Number(tag(raw, 'TiempoEsperaEnvio')) || 0,
    lines,
    raw,
  };
}

/** POSTs a SOAP body to `endpoint` with the taxpayer's certificate as TLS client credentials. */
function postSoap(endpoint, pfx, passphrase, body, trust) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const payload = Buffer.from(soap(body), 'utf8');
    const req = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname,
        port: url.port || 443,
        pfx,
        passphrase,
        ca: trust?.ca,
        minVersion: 'TLSv1.2',
        timeout: 90_000,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '',
          'Content-Length': payload.length,
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > 8 << 20) req.destroy(new Error('aeat: response too large'));
          else chunks.push(c);
        });
        res.on('end', () => {
          try {
            resolve(parseResponse(res.statusCode ?? 0, Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('aeat: timed out')));
    req.on('error', (e) => reject(new Error(`aeat: contacting the tax agency: ${e.message}`)));
    req.end(payload);
  });
}

/** Posts one RegFactuSistemaFacturacion body to AEAT's test or production service. */
const sendToAeat = (env, pfx, passphrase, body) => postSoap(AEAT_ENDPOINT[env], pfx, passphrase, body);

module.exports = { AeatFault, inspectCertificate, parseResponse, postSoap, sendToAeat };
