const { app } = require('@azure/functions');
const store = require('../lib/store');
const audit = require('../lib/audit');
const { endpoint, readJson } = require('../lib/http');
const { requirePlatformAdmin } = require('../lib/authz');

// Hochgeladene Apps laufen in einer Sandbox mit eigenem Ursprung,
// damit sie nicht auf Daten der Startseite (z. B. Login) zugreifen können.
const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals';

function handlePublic(handler) {
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
  handler: handlePublic(async () => ({
    jsonBody: await store.listApps(),
    headers: { 'Cache-Control': 'no-store' },
  })),
});

app.http('appHtml', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'apps/{id}/html',
  handler: handlePublic(async request => ({
    body: await store.readHtml(request.params.id),
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': SANDBOX_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    },
  })),
});

// Apps (Kacheln) verwalten dürfen nur Plattform-Admins.

app.http('createApp', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'manage/apps',
  handler: endpoint(async (request, ctx) => {
    requirePlatformAdmin(ctx);
    const created = await store.createApp(await readJson(request));
    await audit.record(ctx, { action: 'app.created', targetType: 'app', targetId: created.id, details: { title: created.title, type: created.type } });
    return { status: 201, jsonBody: created };
  }),
});

app.http('updateApp', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'manage/apps/{id}',
  handler: endpoint(async (request, ctx) => {
    requirePlatformAdmin(ctx);
    const updated = await store.updateApp(request.params.id, await readJson(request));
    await audit.record(ctx, { action: 'app.updated', targetType: 'app', targetId: updated.id, details: { title: updated.title, type: updated.type } });
    return { jsonBody: updated };
  }),
});

app.http('deleteApp', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'manage/apps/{id}',
  handler: endpoint(async (request, ctx) => {
    requirePlatformAdmin(ctx);
    await store.deleteApp(request.params.id);
    await audit.record(ctx, { action: 'app.deleted', targetType: 'app', targetId: request.params.id });
    return { status: 204 };
  }),
});
