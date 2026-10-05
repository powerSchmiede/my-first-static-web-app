// Liest die von Azure Static Web Apps gesetzte Identität.
// Die Kopfzeile ist nur vertrauenswürdig, weil die Managed Functions ausschließlich
// über die Static Web App erreichbar sind. Bei einer eigenständigen Function App
// muss der direkte Zugriff zusätzlich abgesichert werden.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMAIL_CLAIMS = [
  'email',
  'emails',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'preferred_username',
];

function allowedProviders() {
  return (process.env.ALLOWED_IDENTITY_PROVIDERS || 'aad')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return EMAIL_PATTERN.test(email) && email.length <= 254 ? email : '';
}

function readPrincipal(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return null;

  let raw;
  try {
    raw = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!raw || !raw.userId || !raw.identityProvider) return null;
  if (!allowedProviders().includes(raw.identityProvider)) return null;

  const claims = Array.isArray(raw.claims) ? raw.claims : [];
  const claim = types => {
    for (const type of types) {
      const found = claims.find(c => c.typ === type && c.val);
      if (found) return found.val;
    }
    return null;
  };

  const email = normalizeEmail(claim(EMAIL_CLAIMS) || raw.userDetails);
  return {
    identityId: `${raw.identityProvider}|${raw.userId}`,
    provider: raw.identityProvider,
    email,
    name: (claim(['name']) || raw.userDetails || email || '').toString().slice(0, 120),
  };
}

module.exports = { readPrincipal, normalizeEmail, EMAIL_PATTERN };
