// Liest die von Azure Static Web Apps gesetzte Identität.
// Die Kopfzeile ist nur vertrauenswürdig, weil die Managed Functions ausschließlich
// über die Static Web App erreichbar sind. Bei einer eigenständigen Function App
// muss der direkte Zugriff zusätzlich abgesichert werden.
//
// Die API erhält keine Claims, nur Anbieter, userId und userDetails. Daraus wird
// eine stabile, anbieterübergreifende Identität gebildet:
//
// - KanzleiMind-Konten (Entra External ID): Anmelden und Registrieren sind zwei
//   Login-Konfigurationen desselben Verzeichnisses. Die E-Mail ist dort eindeutig
//   und bei der Registrierung bestätigt, deshalb ist sie der Schlüssel ("ciam|<email>").
// - Microsoft-365-Konten (Entra ID, mandantenübergreifend): Schlüssel ist die von der
//   Static Web App vergebene userId ("m365|<userId>"). Als E-Mail dient der Anmeldename
//   (preferred_username/UPN, siehe staticwebapp.config.json). Dessen Domain muss im
//   Mandanten verifiziert sein. Das frei änderbare E-Mail-Attribut wird bewusst nicht
//   verwendet (Schutz vor Übernahme fremder Einladungen per gefälschter E-Mail).

// Ohne / \ # ? – die Adresse dient auch als Schlüssel in Table Storage.
const EMAIL_PATTERN = /^[^\s@/\\#?]+@[^\s@/\\#?]+\.[^\s@/\\#?]+$/;

// Anbietername aus staticwebapp.config.json -> Art der Identität
const PROVIDERS = {
  kanzleimind: 'ciam',
  kanzleimindsignup: 'ciam',
  aad: 'm365',
};

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

  const kind = PROVIDERS[raw.identityProvider];
  if (!kind) return null;

  // Gastkonten (#EXT#) tragen keinen eigenen Anmeldenamen der Kanzlei.
  if (kind === 'm365' && /#ext#/i.test(String(raw.userDetails || ''))) return null;
  const email = normalizeEmail(raw.userDetails);
  // Ohne bestätigte E-Mail gibt es keine KanzleiMind-Identität.
  if (kind === 'ciam' && !email) return null;

  return {
    identityId: kind === 'ciam' ? `ciam|${email}` : `m365|${raw.userId}`,
    provider: raw.identityProvider,
    kind,
    email,
    name: (email || '').slice(0, 120),
  };
}

module.exports = { readPrincipal, normalizeEmail, EMAIL_PATTERN, PROVIDERS };
