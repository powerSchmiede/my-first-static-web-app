const { HttpError, AccessDenied } = require('./errors');
const { resolveContext } = require('./context');
const audit = require('./audit');

const NO_STORE = { 'Cache-Control': 'no-store' };

async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('kein Objekt');
    return body;
  } catch {
    throw new HttpError(400, 'Ungültige Anfrage.');
  }
}

// Gemeinsamer Rahmen für alle Endpunkte: Kontext ermitteln, Fehler einheitlich
// beantworten, verweigerte Zugriffe auditieren.
function endpoint(handler) {
  return async (request, invocation) => {
    let ctx = { principal: null, isPlatformAdmin: false, membership: null };
    try {
      ctx = await resolveContext(request);
      const result = await handler(request, ctx, invocation);
      return { ...result, headers: { ...NO_STORE, ...(result && result.headers) } };
    } catch (e) {
      if (e instanceof AccessDenied) {
        await audit.record(ctx, {
          organizationId: ctx.membership ? ctx.membership.organizationId : undefined,
          action: 'access.denied',
          targetType: 'endpoint',
          targetId: `${request.method} ${new URL(request.url).pathname}`,
          result: 'denied',
          details: e.details || {},
        });
      }
      if (e instanceof HttpError) {
        if (e.status >= 500) invocation.error(e.message);
        return { status: e.status, jsonBody: { error: e.message, code: e.code }, headers: NO_STORE };
      }
      invocation.error(e);
      return { status: 500, jsonBody: { error: 'Interner Fehler. Bitte später erneut versuchen.' }, headers: NO_STORE };
    }
  };
}

module.exports = { endpoint, readJson };
