// Rechte-Anträge, To-dos und der freigegebene Rechte-Stand je Benutzer.
// Alles liegt in OrgData (Partition = OrganizationId) und wird mit der Organisation gelöscht.
//
//   req_<id>       Antrag: Kanzlei schlägt Rechte für einen Benutzer vor, Mandant gibt frei
//   todo_<id>      Aufgabe für eine Person, eine Gruppe, die Org-Admins oder die Kanzlei
//   sysr_<userId>  freigegebener und umgesetzter Stand der Systemrechte (Dokumentation)

const crypto = require('crypto');
const { table, getOrNull, listAll, odata, isConflict } = require('./tables');
const { HttpError } = require('./errors');

const REQ = 'req_';
const TODO = 'todo_';
const SYSR = 'sysr_';
const range = prefix => ({ from: prefix, to: prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1) });

function assertId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new HttpError(404, 'Nicht gefunden.');
}

const parse = (value, fallback) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};

async function listPrefix(organizationId, prefix) {
  const client = await table('orgData');
  const { from, to } = range(prefix);
  return listAll(client, odata`PartitionKey eq ${organizationId} and RowKey ge ${from} and RowKey lt ${to}`);
}

// ---------- Systemrechte (dokumentierter Stand) ----------

async function getSystemRights(organizationId, userId) {
  const client = await table('orgData');
  const entity = await getOrNull(client, organizationId, SYSR + userId);
  return { rights: parse(entity && entity.rights, {}), updatedAt: entity ? entity.updatedAt : '', requestId: entity ? entity.requestId : '' };
}

async function listSystemRights(organizationId) {
  const entities = await listPrefix(organizationId, SYSR);
  return Object.fromEntries(entities.map(e => [e.rowKey.slice(SYSR.length), { rights: parse(e.rights, {}), updatedAt: e.updatedAt }]));
}

async function setSystemRights(organizationId, userId, system, rights, requestId) {
  const current = await getSystemRights(organizationId, userId);
  const client = await table('orgData');
  await client.upsertEntity({
    partitionKey: organizationId,
    rowKey: SYSR + userId,
    rights: JSON.stringify({ ...current.rights, [system]: rights }),
    requestId,
    updatedAt: new Date().toISOString(),
  }, 'Replace');
}

// ---------- Anträge ----------

function toRequest(entity) {
  return {
    id: entity.rowKey.slice(REQ.length),
    organizationId: entity.partitionKey,
    system: entity.system,
    targetUserId: entity.targetUserId,
    targetEmail: entity.targetEmail,
    targetName: entity.targetName || '',
    current: parse(entity.current, []),
    proposed: parse(entity.proposed, []),
    approved: parse(entity.approved, []),
    status: entity.status,
    comment: entity.comment || '',
    approver: parse(entity.approver, { type: 'admins' }),
    createdBy: entity.createdBy,
    createdAt: entity.createdAt,
    decidedBy: entity.decidedBy || '',
    decidedAt: entity.decidedAt || '',
    decisionComment: entity.decisionComment || '',
    implementedBy: entity.implementedBy || '',
    implementedAt: entity.implementedAt || '',
  };
}

async function createRequest(organizationId, data) {
  const entity = {
    partitionKey: organizationId,
    rowKey: REQ + crypto.randomUUID(),
    system: data.system,
    targetUserId: data.targetUserId,
    targetEmail: data.targetEmail,
    targetName: data.targetName,
    current: JSON.stringify(data.current),
    proposed: JSON.stringify(data.proposed),
    approved: '[]',
    status: 'pending',
    comment: data.comment || '',
    approver: JSON.stringify(data.approver),
    createdBy: data.createdBy,
    createdAt: new Date().toISOString(),
  };
  const client = await table('orgData');
  await client.createEntity(entity);
  return toRequest(entity);
}

async function getRequestEntity(organizationId, requestId) {
  assertId(requestId);
  const client = await table('orgData');
  return getOrNull(client, organizationId, REQ + requestId);
}

async function getRequest(organizationId, requestId) {
  const entity = await getRequestEntity(organizationId, requestId);
  return entity ? toRequest(entity) : null;
}

async function listRequests(organizationId) {
  return (await listPrefix(organizationId, REQ)).map(toRequest).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// Zustandswechsel mit ETag: Zwei gleichzeitige Entscheidungen können sich nicht überschreiben.
async function transitionRequest(organizationId, requestId, fromStatus, changes) {
  const entity = await getRequestEntity(organizationId, requestId);
  if (!entity) throw new HttpError(404, 'Nicht gefunden.');
  if (entity.status !== fromStatus) throw new HttpError(409, 'Dieser Antrag wurde bereits bearbeitet.', 'request_state');
  const patch = { ...changes };
  for (const key of ['approved']) if (Array.isArray(patch[key])) patch[key] = JSON.stringify(patch[key]);
  const client = await table('orgData');
  try {
    await client.updateEntity({ partitionKey: organizationId, rowKey: entity.rowKey, ...patch }, 'Merge', { etag: entity.etag });
  } catch (e) {
    if (isConflict(e)) throw new HttpError(409, 'Dieser Antrag wurde gerade bearbeitet. Bitte neu laden.', 'request_state');
    throw e;
  }
  return toRequest({ ...entity, ...patch });
}

// ---------- To-dos ----------

function toTodo(entity) {
  return {
    id: entity.rowKey.slice(TODO.length),
    organizationId: entity.partitionKey,
    title: entity.title,
    description: entity.description || '',
    kind: entity.kind || 'general',
    requestId: entity.requestId || '',
    assignee: parse(entity.assignee, { type: 'admins' }),
    status: entity.status,
    createdAt: entity.createdAt,
    createdBy: entity.createdBy || '',
    completedAt: entity.completedAt || '',
    completedBy: entity.completedBy || '',
  };
}

async function createTodo(organizationId, data) {
  const entity = {
    partitionKey: organizationId,
    rowKey: TODO + crypto.randomUUID(),
    title: String(data.title).slice(0, 200),
    description: String(data.description || '').slice(0, 2000),
    kind: data.kind || 'general',
    requestId: data.requestId || '',
    assignee: JSON.stringify(data.assignee),
    status: 'open',
    createdAt: new Date().toISOString(),
    createdBy: data.createdBy || '',
  };
  const client = await table('orgData');
  await client.createEntity(entity);
  return toTodo(entity);
}

async function listTodos(organizationId) {
  return (await listPrefix(organizationId, TODO)).map(toTodo).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function completeTodosForRequest(organizationId, requestId, kind, completedBy) {
  const client = await table('orgData');
  for (const todo of (await listTodos(organizationId)).filter(t => t.requestId === requestId && t.kind === kind && t.status === 'open')) {
    await client.updateEntity({ partitionKey: organizationId, rowKey: TODO + todo.id, status: 'done', completedAt: new Date().toISOString(), completedBy }, 'Merge');
  }
}

// Beim Entfernen eines Benutzers: Stand löschen, offene Anträge für ihn abbrechen.
async function purgeUser(organizationId, userId, by) {
  const client = await table('orgData');
  await client.deleteEntity(organizationId, SYSR + userId).catch(e => { if (e.statusCode !== 404) throw e; });
  for (const request of (await listRequests(organizationId)).filter(r => r.targetUserId === userId && ['pending', 'approved'].includes(r.status))) {
    await client.updateEntity({ partitionKey: organizationId, rowKey: REQ + request.id, status: 'cancelled' }, 'Merge');
    for (const kind of ['approval', 'implementation']) await completeTodosForRequest(organizationId, request.id, kind, by);
  }
}

module.exports = {
  getSystemRights, listSystemRights, setSystemRights,
  createRequest, getRequest, listRequests, transitionRequest,
  createTodo, listTodos, completeTodosForRequest, purgeUser,
};
