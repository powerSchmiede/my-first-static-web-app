const { app } = require('@azure/functions');
const store = require('../lib/store');
const audit = require('../lib/audit');
const { endpoint, readJson } = require('../lib/http');
const { requirePlatformAdmin } = require('../lib/authz');
const service = require('../lib/service');

// Hochgeladene Apps laufen in einer Sandbox mit eigenem Ursprung,
// damit sie nicht auf Daten der Startseite (z. B. Login) zugreifen können.
const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals';

// Apps sehen nur angemeldete Benutzer, und zwar nur die für ihre Organisation
// freigegebenen. Plattform-Admins sehen alle.
app.http('listApps', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'apps',
  handler: endpoint(async (request, ctx) => ({ jsonBody: await service.listVisibleApps(ctx) })),
});

app.http('appHtml', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'apps/{id}/html',
  handler: endpoint(async (request, ctx) => ({
    body: await service.readAppHtml(ctx, request.params.id),
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': SANDBOX_CSP,
      'X-Content-Type-Options': 'nosniff',
    },
  })),
});

// Apps (Kacheln) verwalten dürfen nur Plattform-Admins.

app.http('createApp', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'manage/apps',
  handler: endpoint(async (request, ctx) => {
    requirePlatformAdmin(ctx);
    // Alle KanzleiMind-Apps, unabhängig von einer eigenen Mitgliedschaft des Plattform-Admins
    if (request.method === 'GET') return { jsonBody: await store.listApps() };
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
    await service.deleteApp(ctx, request.params.id);
    return { status: 204 };
  }),
});
