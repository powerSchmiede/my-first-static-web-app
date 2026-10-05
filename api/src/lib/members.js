const crypto = require('crypto');
const { table, getOrNull, listAll, odata, isConflict } = require('./tables');
const { HttpError } = require('./errors');

// Benutzer und Einladungen liegen in derselben Tabelle und Partition (= OrganizationId).
// Jede Funktion verlangt die OrganizationId; eine organisationsübergreifende Abfrage
// ist in dieser Schicht bewusst nicht möglich.

const USER_PREFIX = 'user_';
const INVITE_PREFIX = 'inv_';
const INVITATION_DAYS = 7;
const USER_STATUSES = ['Active', 'Disabled'];

function assertOrg(organizationId) {
  if (!organizationId || typeof organizationId !== 'string') throw new Error('organizationId fehlt');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function prefixRange(prefix) {
  // Alle RowKeys, die mit dem Präfix beginnen ("_" + 1 = "`").
  return { from: prefix, to: prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1) };
}

// ---------- Benutzer ----------

function toUser(entity) {
  return {
    id: entity.rowKey.slice(USER_PREFIX.length),
    organizationId: entity.partitionKey,
    identityId: entity.identityId,
    email: entity.email,
    displayName: entity.displayName,
    role: entity.role,
    status: entity.status,
    createdAt: entity.createdAt,
    invitedAt: entity.invitedAt || '',
    invitedBy: entity.invitedBy || '',
    lastLoginAt: entity.lastLoginAt || '',
  };
}

async function listUsers(organizationId) {
  assertOrg(organizationId);
  const client = await table('orgData');
  const { from, to } = prefixRange(USER_PREFIX);
  const entities = await listAll(client, odata`PartitionKey eq ${organizationId} and RowKey ge ${from} and RowKey lt ${to}`);
  return entities.map(toUser);
}

async function getUserEntity(organizationId, userId) {
  assertOrg(organizationId);
  if (!userId || typeof userId !== 'string') return null;
  const client = await table('orgData');
  return getOrNull(client, organizationId, USER_PREFIX + userId);
}

async function getUser(organizationId, userId) {
  const entity = await getUserEntity(organizationId, userId);
  return entity ? toUser(entity) : null;
}

async function updateUser(organizationId, userId, patch) {
  const client = await table('orgData');
  const entity = await getUserEntity(organizationId, userId);
  if (!entity) throw new HttpError(404, 'Nicht gefunden.');
  const changes = {};
  if (patch.status !== undefined) {
    if (!USER_STATUSES.includes(patch.status)) throw new HttpError(400, 'Unbekannter Status.');
    changes.status = patch.status;
  }
  if (patch.role !== undefined) changes.role = patch.role;
  if (patch.lastLoginAt !== undefined) changes.lastLoginAt = patch.lastLoginAt;
  try {
    await client.updateEntity({ partitionKey: organizationId, rowKey: entity.rowKey, ...changes }, 'Merge', { etag: entity.etag });
  } catch (e) {
    if (isConflict(e)) throw new HttpError(409, 'Der Benutzer wurde gerade geändert. Bitte neu laden.');
    throw e;
  }
  return toUser({ ...entity, ...changes });
}

async function deleteUser(organizationId, userId) {
  const client = await table('orgData');
  const entity = await getUserEntity(organizationId, userId);
  if (!entity) throw new HttpError(404, 'Nicht gefunden.');
  await client.deleteEntity(organizationId, entity.rowKey);
  const identities = await table('identities');
  const index = await getOrNull(identities, entity.identityId, 'membership');
  if (index && index.organizationId === organizationId && index.userId === userId) {
    await identities.deleteEntity(entity.identityId, 'membership');
  }
  return toUser(entity);
}

// ---------- Einladungen ----------

function invitationState(entity) {
  if (entity.status === 'Pending' && new Date(entity.expiresAt) < new Date()) return 'Expired';
  return entity.status;
}

function toInvitation(entity) {
  return {
    id: entity.rowKey.slice(INVITE_PREFIX.length),
    organizationId: entity.partitionKey,
    email: entity.email,
    role: entity.role,
    status: invitationState(entity),
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
    invitedBy: entity.invitedBy,
    sentCount: entity.sentCount || 0,
    lastSentAt: entity.lastSentAt || '',
    acceptedAt: entity.acceptedAt || '',
  };
}

async function listInvitations(organizationId) {
  assertOrg(organizationId);
  const client = await table('orgData');
  const { from, to } = prefixRange(INVITE_PREFIX);
  const entities = await listAll(client, odata`PartitionKey eq ${organizationId} and RowKey ge ${from} and RowKey lt ${to}`);
  return entities.map(toInvitation).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function getInvitationEntity(organizationId, invitationId) {
  assertOrg(organizationId);
  if (!invitationId || typeof invitationId !== 'string') return null;
  const client = await table('orgData');
  return getOrNull(client, organizationId, INVITE_PREFIX + invitationId);
}

function expiry() {
  return new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

async function storeToken(organizationId, invitationId, token) {
  const tokens = await table('invitationTokens');
  await tokens.createEntity({ partitionKey: hashToken(token), rowKey: 'token', organizationId, invitationId });
}

async function dropToken(tokenHash) {
  if (!tokenHash) return;
  const tokens = await table('invitationTokens');
  await tokens.deleteEntity(tokenHash, 'token').catch(e => { if (e.statusCode !== 404) throw e; });
}

async function countRecentInvitations(organizationId, sinceIso) {
  const invitations = await listInvitations(organizationId);
  return invitations.filter(i => i.lastSentAt >= sinceIso || i.createdAt >= sinceIso).length;
}

async function createInvitation(organizationId, { email, role, invitedBy }) {
  assertOrg(organizationId);
  const [users, invitations] = await Promise.all([listUsers(organizationId), listInvitations(organizationId)]);
  if (users.some(u => u.email === email)) throw new HttpError(409, 'Diese E-Mail-Adresse gehört bereits zu einem Benutzer der Organisation.');
  if (invitations.some(i => i.email === email && i.status === 'Pending')) {
    throw new HttpError(409, 'Für diese E-Mail-Adresse gibt es bereits eine offene Einladung. Nutze „Erneut senden“.');
  }

  const id = crypto.randomUUID();
  const token = newToken();
  const now = new Date().toISOString();
  const entity = {
    partitionKey: organizationId,
    rowKey: INVITE_PREFIX + id,
    email,
    role,
    status: 'Pending',
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt: expiry(),
    invitedBy,
    sentCount: 1,
    lastSentAt: now,
  };
  const client = await table('orgData');
  await client.createEntity(entity);
  await storeToken(organizationId, id, token);
  return { invitation: toInvitation(entity), token };
}

async function renewInvitation(organizationId, invitationId) {
  const client = await table('orgData');
  const entity = await getInvitationEntity(organizationId, invitationId);
  if (!entity) throw new HttpError(404, 'Nicht gefunden.');
  if (entity.status !== 'Pending') throw new HttpError(409, 'Nur offene Einladungen können erneut gesendet werden.');

  const token = newToken();
  const now = new Date().toISOString();
  const changes = { tokenHash: hashToken(token), expiresAt: expiry(), sentCount: (entity.sentCount || 0) + 1, lastSentAt: now };
  await client.updateEntity({ partitionKey: organizationId, rowKey: entity.rowKey, ...changes }, 'Merge', { etag: entity.etag });
  await dropToken(entity.tokenHash);
  await storeToken(organizationId, invitationId, token);
  return { invitation: toInvitation({ ...entity, ...changes }), token };
}

async function revokeInvitation(organizationId, invitationId) {
  const client = await table('orgData');
  const entity = await getInvitationEntity(organizationId, invitationId);
  if (!entity) throw new HttpError(404, 'Nicht gefunden.');
  if (entity.status !== 'Pending') throw new HttpError(409, 'Nur offene Einladungen können zurückgezogen werden.');
  await client.updateEntity({ partitionKey: organizationId, rowKey: entity.rowKey, status: 'Revoked' }, 'Merge', { etag: entity.etag });
  await dropToken(entity.tokenHash);
  return toInvitation({ ...entity, status: 'Revoked' });
}

// Löst ein Token auf, ohne es zu verbrauchen (für die Vorschau auf der Einladungsseite).
async function findInvitationByToken(token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const tokens = await table('invitationTokens');
  const pointer = await getOrNull(tokens, hashToken(token), 'token');
  if (!pointer) return null;
  const entity = await getInvitationEntity(pointer.organizationId, pointer.invitationId);
  if (!entity || entity.tokenHash !== hashToken(token)) return null;
  return entity;
}

// Nimmt eine Einladung an. Bindung an die verifizierte E-Mail der Anmeldung,
// Einmalnutzung über ETag, eine Organisation pro Identität über den IdentityIndex.
async function acceptInvitation(token, principal) {
  const entity = await findInvitationByToken(token);
  if (!entity) throw new HttpError(404, 'Diese Einladung ist ungültig oder wurde bereits verwendet.');
  const state = invitationState(entity);
  if (state === 'Expired') throw new HttpError(410, 'Diese Einladung ist abgelaufen. Bitte fordere eine neue an.');
  if (state !== 'Pending') throw new HttpError(404, 'Diese Einladung ist ungültig oder wurde bereits verwendet.');
  if (!principal.email || principal.email !== entity.email) {
    throw new HttpError(403, 'Diese Einladung gilt für eine andere E-Mail-Adresse. Bitte melde dich mit der eingeladenen Adresse an.', 'email_mismatch');
  }

  const organizationId = entity.partitionKey;
  const userId = crypto.randomUUID();
  const identities = await table('identities');
  try {
    await identities.createEntity({ partitionKey: principal.identityId, rowKey: 'membership', organizationId, userId });
  } catch (e) {
    if (isConflict(e)) throw new HttpError(409, 'Dein Konto gehört bereits zu einer Organisation.', 'already_member');
    throw e;
  }

  const now = new Date().toISOString();
  const user = {
    partitionKey: organizationId,
    rowKey: USER_PREFIX + userId,
    identityId: principal.identityId,
    email: principal.email,
    displayName: principal.name || principal.email,
    role: entity.role,
    status: 'Active',
    createdAt: now,
    invitedAt: entity.createdAt,
    invitedBy: entity.invitedBy,
    lastLoginAt: now,
  };

  const client = await table('orgData');
  try {
    await client.submitTransaction([
      ['update', { partitionKey: organizationId, rowKey: entity.rowKey, status: 'Accepted', acceptedAt: now, acceptedBy: principal.identityId }, 'Merge', { etag: entity.etag }],
      ['create', user],
    ]);
  } catch (e) {
    await identities.deleteEntity(principal.identityId, 'membership').catch(() => {});
    if (isConflict(e)) throw new HttpError(409, 'Diese Einladung wurde gerade schon verwendet.');
    throw e;
  }
  await dropToken(entity.tokenHash);
  return { user: toUser(user), invitation: toInvitation({ ...entity, status: 'Accepted', acceptedAt: now }) };
}

// Liefert die Mitgliedschaft einer Identität aus dem IdentityIndex.
async function findMembership(identityId) {
  const identities = await table('identities');
  return getOrNull(identities, identityId, 'membership');
}

module.exports = {
  listUsers,
  getUser,
  updateUser,
  deleteUser,
  listInvitations,
  createInvitation,
  renewInvitation,
  revokeInvitation,
  findInvitationByToken,
  acceptInvitation,
  findMembership,
  countRecentInvitations,
  invitationState,
};
