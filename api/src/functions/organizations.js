const { app } = require('@azure/functions');
const { endpoint, readJson } = require('../lib/http');
const { HttpError } = require('../lib/errors');
const service = require('../lib/service');

// Jede Route enthält die OrganizationId nur als Ziel der Anfrage. Ob der Benutzer
// darauf zugreifen darf, entscheidet ausschließlich die serverseitige Prüfung in service.js.

function methodNotAllowed() {
  throw new HttpError(405, 'Methode nicht erlaubt.');
}

app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: endpoint(async (request, ctx) => ({ jsonBody: service.me(ctx) })),
});

app.http('organization', {
  methods: ['GET', 'PATCH'],
  authLevel: 'anonymous',
  route: 'orgs/{orgId}',
  handler: endpoint(async (request, ctx) => {
    const { orgId } = request.params;
    if (request.method === 'GET') return { jsonBody: await service.getOrganization(ctx, orgId) };
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      return { jsonBody: await service.renameOrganization(ctx, orgId, body.name) };
    }
    return methodNotAllowed();
  }),
});

app.http('organizationUsers', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'orgs/{orgId}/users',
  handler: endpoint(async (request, ctx) => ({ jsonBody: await service.listUsers(ctx, request.params.orgId) })),
});

app.http('organizationUser', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'orgs/{orgId}/users/{userId}',
  handler: endpoint(async (request, ctx) => {
    const { orgId, userId } = request.params;
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      return { jsonBody: await service.updateUser(ctx, orgId, userId, { role: body.role, status: body.status }) };
    }
    if (request.method === 'DELETE') {
      await service.removeUser(ctx, orgId, userId);
      return { status: 204 };
    }
    return methodNotAllowed();
  }),
});

app.http('organizationInvitations', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'orgs/{orgId}/invitations',
  handler: endpoint(async (request, ctx) => {
    const { orgId } = request.params;
    if (request.method === 'GET') return { jsonBody: await service.listInvitations(ctx, orgId) };
    if (request.method === 'POST') {
      const body = await readJson(request);
      return { status: 201, jsonBody: await service.invite(ctx, orgId, { email: body.email, role: body.role }) };
    }
    return methodNotAllowed();
  }),
});

app.http('organizationInvitation', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'orgs/{orgId}/invitations/{invitationId}',
  handler: endpoint(async (request, ctx) => ({
    jsonBody: await service.revokeInvitation(ctx, request.params.orgId, request.params.invitationId),
  })),
});

app.http('organizationInvitationResend', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'orgs/{orgId}/invitations/{invitationId}/resend',
  handler: endpoint(async (request, ctx) => ({
    jsonBody: await service.resendInvitation(ctx, request.params.orgId, request.params.invitationId),
  })),
});

app.http('organizationAudit', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'orgs/{orgId}/audit',
  handler: endpoint(async (request, ctx) => ({ jsonBody: await service.listAudit(ctx, request.params.orgId) })),
});

// ---------- Plattform ----------

app.http('platformOrganizations', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'platform/orgs',
  handler: endpoint(async (request, ctx) => {
    if (request.method === 'GET') return { jsonBody: await service.listOrganizations(ctx) };
    if (request.method === 'POST') {
      const body = await readJson(request);
      return { status: 201, jsonBody: await service.createOrganization(ctx, { name: body.name, adminEmail: body.adminEmail, appIds: body.appIds }) };
    }
    return methodNotAllowed();
  }),
});

app.http('platformOrganization', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'platform/orgs/{orgId}',
  handler: endpoint(async (request, ctx) => {
    const body = await readJson(request);
    return { jsonBody: await service.setOrganizationStatus(ctx, request.params.orgId, body.status) };
  }),
});

// POST statt DELETE, damit die Namensbestätigung sicher im Body ankommt.
app.http('platformOrganizationDelete', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'platform/orgs/{orgId}/delete',
  handler: endpoint(async (request, ctx) => {
    const body = await readJson(request);
    await service.deleteOrganization(ctx, request.params.orgId, body.confirmName);
    return { status: 204 };
  }),
});

app.http('platformOrganizationApps', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'platform/orgs/{orgId}/apps',
  handler: endpoint(async (request, ctx) => {
    const { orgId } = request.params;
    if (request.method === 'GET') return { jsonBody: await service.getOrganizationApps(ctx, orgId) };
    if (request.method === 'PUT') {
      const body = await readJson(request);
      return { jsonBody: await service.setOrganizationApps(ctx, orgId, body.appIds) };
    }
    return methodNotAllowed();
  }),
});

app.http('platformAudit', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'platform/audit',
  handler: endpoint(async (request, ctx) => ({ jsonBody: await service.listPlatformAudit(ctx) })),
});

// ---------- Einladungen annehmen ----------
// Der Token wird im Body übertragen, damit er nicht in URLs und Server-Logs landet.

app.http('invitationPreview', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'invitations/preview',
  handler: endpoint(async request => {
    const body = await readJson(request);
    return { jsonBody: await service.previewInvitation(body.token) };
  }),
});

app.http('invitationAccept', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'invitations/accept',
  handler: endpoint(async (request, ctx) => {
    const body = await readJson(request);
    return { jsonBody: await service.acceptInvitation(ctx, body.token) };
  }),
});
