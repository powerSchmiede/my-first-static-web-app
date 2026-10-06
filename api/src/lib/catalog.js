// Apps der Organisation und eigene Apps der Benutzer samt persönlicher Einstellungen.
// Alles liegt in OrgData (Partition = OrganizationId) und wird mit der Organisation gelöscht.
//
//   oapp_<id>             App der Organisation (nur Links)
//   uapp_<userId>_<id>    Eigene App eines Benutzers (nur Links)
//   upref_<userId>        Reihenfolge und ausgeblendete Apps eines Benutzers

const crypto = require('crypto');
const { table, getOrNull, listAll, odata } = require('./tables');
const { HttpError } = require('./errors');
const { ICONS, BACKGROUNDS } = require('./store');

const ORG_APP_PREFIX = 'oapp_';
const USER_APP_PREFIX = 'uapp_';
const PREF_PREFIX = 'upref_';
const MAX_ORG_APPS = 100;
const MAX_USER_APPS = 30;
const MAX_PREF_KEYS = 300;

function range(prefix) {
  return { from: prefix, to: prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1) };
}

function assertOrg(organizationId) {
  if (!organizationId || typeof organizationId !== 'string') throw new Error('organizationId fehlt');
}

function assertId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new HttpError(404, 'Nicht gefunden.');
}

// Nur https-Links: Org-Admins und Benutzer dürfen keine internen Pfade oder Skript-Adressen hinterlegen.
function validateLink(input) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 60) throw new HttpError(400, 'Der Name muss 1 bis 60 Zeichen lang sein.');
  if (!ICONS.includes(input.icon)) throw new HttpError(400, 'Unbekanntes Symbol.');
  if (!BACKGROUNDS.includes(input.background)) throw new HttpError(400, 'Unbekannter Hintergrund.');
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== 'https:' || url.length > 2000) {
    throw new HttpError(400, 'Bitte eine gültige https-Adresse eingeben (https://…).');
  }
  return { title, url: parsed.href, icon: input.icon, background: input.background };
}

function toLinkApp(entity, prefixLength) {
  return {
    id: entity.rowKey.slice(prefixLength),
    title: entity.title,
    type: 'link',
    url: entity.url,
    icon: entity.icon,
    background: entity.background,
    enabled: entity.enabled !== false,
    createdAt: entity.createdAt,
  };
}

// ---------- Apps der Organisation ----------

async function listOrgApps(organizationId) {
  assertOrg(organizationId);
  const client = await table('orgData');
  const { from, to } = range(ORG_APP_PREFIX);
  const entities = await listAll(client, odata`PartitionKey eq ${organizationId} and RowKey ge ${from} and RowKey lt ${to}`);
  return entities.map(e => toLinkApp(e, ORG_APP_PREFIX.length)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

async function createOrgApp(organizationId, input, createdBy) {
  const data = validateLink(input);
  if ((await listOrgApps(organizationId)).length >= MAX_ORG_APPS) {
    throw new HttpError(409, `Eine Organisation kann höchstens ${MAX_ORG_APPS} eigene Apps anlegen.`);
  }
  const entity = {
    partitionKey: organizationId,
    rowKey: ORG_APP_PREFIX + crypto.randomUUID(),
    ...data,
    enabled: input.enabled !== false,
    createdBy,
    createdAt: new Date().toISOString(),
  };
  const client = await table('orgData');
  await client.createEntity(entity);
  return toLinkApp(entity, ORG_APP_PREFIX.length);
}

async function updateOrgApp(organizationId, appId, input) {
  assertId(appId);
  const client = await table('orgData');
  const entity = await getOrNull(client, organizationId, ORG_APP_PREFIX + appId);
  if (!entity) throw new HttpError(404, 'Nicht gefunden.');
  const changes = {};
  if (input.title !== undefined || input.url !== undefined || input.icon !== undefined || input.background !== undefined) {
    Object.assign(changes, validateLink({ ...entity, ...input }));
  }
  if (input.enabled !== undefined) changes.enabled = input.enabled === true;
  await client.updateEntity({ partitionKey: organizationId, rowKey: entity.rowKey, ...changes }, 'Merge', { etag: entity.etag });
  return toLinkApp({ ...entity, ...changes }, ORG_APP_PREFIX.length);
}

async function deleteOrgApp(organizationId, appId) {
  assertId(appId);
  const client = await table('orgData');
  const entity = await getOrNull(client, organizationId, ORG_APP_PREFIX + appId);
  if (!entity) throw new HttpError(404, 'Nicht gefunden.');
  await client.deleteEntity(organizationId, entity.rowKey);
  return toLinkApp(entity, ORG_APP_PREFIX.length);
}

// ---------- Eigene Apps der Benutzer ----------

function userPrefix(userId) {
  if (!userId || typeof userId !== 'string') throw new Error('userId fehlt');
  return `${USER_APP_PREFIX}${userId}_`;
}

async function listUserApps(organizationId, userId) {
  assertOrg(organizationId);
  const prefix = userPrefix(userId);
  const client = await table('orgData');
  const { from, to } = range(prefix);
  const entities = await listAll(client, odata`PartitionKey eq ${organizationId} and RowKey ge ${from} and RowKey lt ${to}`);
  return entities.map(e => toLinkApp(e, prefix.length)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

async function createUserApp(organizationId, userId, input) {
  const data = validateLink(input);
  if ((await listUserApps(organizationId, userId)).length >= MAX_USER_APPS) {
    throw new HttpError(409, `Du kannst höchstens ${MAX_USER_APPS} eigene Apps anlegen.`);
  }
  const entity = {
    partitionKey: organizationId,
    rowKey: userPrefix(userId) + crypto.randomUUID(),
    ...data,
    createdAt: new Date().toISOString(),
  };
  const client = await table('orgData');
  await client.createEntity(entity);
  return toLinkApp(entity, userPrefix(userId).length);
}

async function updateUserApp(organizationId, userId, appId, input) {
  assertId(appId);
  const client = await table('orgData');
  const entity = await getOrNull(client, organizationId, userPrefix(userId) + appId);
  if (!entity) throw new HttpError(404, 'Nicht gefunden.');
  const data = validateLink({ ...entity, ...input });
  await client.updateEntity({ partitionKey: organizationId, rowKey: entity.rowKey, ...data }, 'Merge', { etag: entity.etag });
  return toLinkApp({ ...entity, ...data }, userPrefix(userId).length);
}

async function deleteUserApp(organizationId, userId, appId) {
  assertId(appId);
  const client = await table('orgData');
  const rowKey = userPrefix(userId) + appId;
  if (!(await getOrNull(client, organizationId, rowKey))) throw new HttpError(404, 'Nicht gefunden.');
  await client.deleteEntity(organizationId, rowKey);
}

// ---------- Persönliche Einstellungen ----------

function parseList(value) {
  try {
    const list = JSON.parse(value || '[]');
    return Array.isArray(list) ? list.filter(k => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function validateKeys(value, label) {
  if (!Array.isArray(value) || value.length > MAX_PREF_KEYS || value.some(k => typeof k !== 'string' || k.length > 120)) {
    throw new HttpError(400, `Ungültige Angabe: ${label}.`);
  }
  return [...new Set(value)];
}

async function getPrefs(organizationId, userId) {
  const client = await table('orgData');
  const entity = await getOrNull(client, organizationId, PREF_PREFIX + userId);
  return { order: parseList(entity && entity.order), hidden: parseList(entity && entity.hidden) };
}

async function setPrefs(organizationId, userId, input) {
  const order = validateKeys(input.order, 'Reihenfolge');
  const hidden = validateKeys(input.hidden, 'ausgeblendete Apps');
  const client = await table('orgData');
  await client.upsertEntity({ partitionKey: organizationId, rowKey: PREF_PREFIX + userId, order: JSON.stringify(order), hidden: JSON.stringify(hidden) }, 'Replace');
  return { order, hidden };
}

// Beim Entfernen eines Benutzers auch seine eigenen Apps und Einstellungen löschen.
async function purgeUser(organizationId, userId) {
  const client = await table('orgData');
  const apps = await listUserApps(organizationId, userId);
  for (const app of apps) {
    await client.deleteEntity(organizationId, userPrefix(userId) + app.id).catch(e => { if (e.statusCode !== 404) throw e; });
  }
  await client.deleteEntity(organizationId, PREF_PREFIX + userId).catch(e => { if (e.statusCode !== 404) throw e; });
}

module.exports = {
  MAX_USER_APPS,
  MAX_ORG_APPS,
  listOrgApps,
  createOrgApp,
  updateOrgApp,
  deleteOrgApp,
  listUserApps,
  createUserApp,
  updateUserApp,
  deleteUserApp,
  getPrefs,
  setPrefs,
  purgeUser,
};
