const { app } = require('@azure/functions');
const store = require('../lib/store');

// Hochgeladene Apps laufen in einer Sandbox mit eigenem Ursprung,
// damit sie nicht auf Daten der Startseite (z. B. Login) zugreifen können.
const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals';

function principal(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function requireAdmin(request) {
  const user = principal(request);
  if (!user) throw new store.HttpError(401, 'Bitte anmelden.');
  if (!(user.userRoles || []).includes('admin')) throw new store.HttpError(403, 'Nur Admins dürfen Apps verwalten.');
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw new store.HttpError(400, 'Ungültige Anfrage.');
  }
}

function handle(handler) {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (e) {
      if (e instanceof store.HttpError) {
        if (e.status >= 500) context.error(e.message);
        return { status: e.status, jsonBody: { error: e.message } };
      }
      context.error(e);
      return { status: 500, jsonBody: { error: 'Interner Fehler. Bitte später erneut versuchen.' } };
    }
  };
}

app.http('listApps', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'apps',
  handler: handle(async () => ({
    jsonBody: await store.listApps(),
    headers: { 'Cache-Control': 'no-store' },
  })),
});

app.http('appHtml', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'apps/{id}/html',
  handler: handle(async request => ({
    body: await store.readHtml(request.params.id),
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': SANDBOX_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    },
  })),
});

// Die Routen unter /api/manage/* sind zusätzlich in staticwebapp.config.json auf die Rolle "admin" beschränkt.
app.http('createApp', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'manage/apps',
  handler: handle(async request => {
    requireAdmin(request);
    return { status: 201, jsonBody: await store.createApp(await readBody(request)) };
  }),
});

app.http('updateApp', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'manage/apps/{id}',
  handler: handle(async request => {
    requireAdmin(request);
    return { jsonBody: await store.updateApp(request.params.id, await readBody(request)) };
  }),
});

app.http('deleteApp', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'manage/apps/{id}',
  handler: handle(async request => {
    requireAdmin(request);
    await store.deleteApp(request.params.id);
    return { status: 204 };
  }),
});
