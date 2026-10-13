const { app } = require('@azure/functions');
const { endpoint, readJson } = require('../lib/http');
const workflow = require('../lib/workflowService');

// Freigabe-Prozess Kanzlei <-> Mandant, To-dos und Kanzlei-Mitarbeitende.
// Alle Rechte prüft workflowService (Kanzlei nur für zugeordnete Mandanten).

app.http('kanzleiMandanten', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'kanzlei/mandanten',
  handler: endpoint(async (request, ctx) => ({ jsonBody: await workflow.listMandanten(ctx) })),
});

app.http('organizationRights', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'orgs/{orgId}/rights',
  handler: endpoint(async (request, ctx) => ({ jsonBody: await workflow.getRightsOverview(ctx, request.params.orgId) })),
});

app.http('rightsRequests', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'orgs/{orgId}/rights-requests',
  handler: endpoint(async (request, ctx) => ({ status: 201, jsonBody: await workflow.createRequest(ctx, request.params.orgId, await readJson(request)) })),
});

app.http('rightsRequest', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'orgs/{orgId}/rights-requests/{requestId}',
  handler: endpoint(async (request, ctx) => ({ jsonBody: await workflow.getRequest(ctx, request.params.orgId, request.params.requestId) })),
});

app.http('rightsRequestDecision', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'orgs/{orgId}/rights-requests/{requestId}/decision',
  handler: endpoint(async (request, ctx) => ({ jsonBody: await workflow.decide(ctx, request.params.orgId, request.params.requestId, await readJson(request)) })),
});

app.http('rightsRequestImplemented', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'orgs/{orgId}/rights-requests/{requestId}/implemented',
  handler: endpoint(async (request, ctx) => ({ jsonBody: await workflow.implement(ctx, request.params.orgId, request.params.requestId, await readJson(request)) })),
});

app.http('rightsApprover', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'orgs/{orgId}/settings/rights-approver',
  handler: endpoint(async (request, ctx) => ({ jsonBody: await workflow.setApprover(ctx, request.params.orgId, await readJson(request)) })),
});

app.http('todos', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'todos',
  handler: endpoint(async (request, ctx) => ({ jsonBody: await workflow.listTodos(ctx) })),
});

app.http('todoDone', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'todos/{orgId}/{todoId}/done',
  handler: endpoint(async (request, ctx) => ({ jsonBody: await workflow.completeTodo(ctx, request.params.orgId, request.params.todoId) })),
});

// ---------- Plattform: Kanzlei-Mitarbeitende ----------

app.http('platformStaff', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'platform/staff',
  handler: endpoint(async (request, ctx) => {
    if (request.method === 'GET') return { jsonBody: await workflow.listStaff(ctx) };
    return { jsonBody: await workflow.saveStaff(ctx, await readJson(request)) };
  }),
});

app.http('platformStaffOrgs', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'platform/staff/{email}/orgs',
  handler: endpoint(async (request, ctx) => {
    const body = await readJson(request);
    return { jsonBody: await workflow.setStaffAssignments(ctx, decodeURIComponent(request.params.email).toLowerCase(), body.organizationIds) };
  }),
});

app.http('platformStaffDelete', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'platform/staff/{email}/delete',
  handler: endpoint(async (request, ctx) => {
    await workflow.removeStaff(ctx, decodeURIComponent(request.params.email).toLowerCase());
    return { status: 204 };
  }),
});
