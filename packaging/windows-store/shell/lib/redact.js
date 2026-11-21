// Log/report hygiene: secrets must never reach a log file or a support report.
function makeRedactor(secrets = []) {
  const literal = secrets.filter((s) => typeof s === 'string' && s.length >= 8);
  return function redact(text) {
    let out = String(text);
    for (const s of literal) out = out.split(s).join('[redacted]');
    return out
      .replace(/(authorization["']?\s*[:=]\s*["']?(?:bearer|basic)\s+)[^\s"']+/gi, '$1[redacted]')
      .replace(/((?:set-)?cookie["']?\s*[:=]\s*["']?)[^\r\n"']+/gi, '$1[redacted]')
      .replace(/((?:password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',}&]+/gi, '$1[redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]');
  };
}
module.exports = { makeRedactor };
