// Gruppen einer Organisation (z. B. Lohn, FiBu, IT, HR). Gespeichert in OrgData
// (Partition = OrganizationId) als "grp_<id>". Die Zugehörigkeit steht am Benutzer (groups).
// Gruppen können Bereichsrechte tragen; Mitglieder erben sie zusätzlich zu ihren eigenen.
// Später: Apps und Ordnerrechte pro Gruppe.

const crypto = require('crypto');
const { table, getOrNull, listAll, odata, isConflict } = require('./tables');
const { HttpError } = require('./errors');
const { parseList, validatePermissions, knownPermissions } = require('./permissions');

const PREFIX = 'grp_';
const RANGE = { from: 'grp_', to: 'grp`' };
const MAX_GROUPS = 50;

function toGroup(entity) {
  return {
    id: entity.rowKey.slice(PREFIX.length),
    name: entity.name,
    permissions: knownPermissions(parseList(entity.permissions)),
    createdAt: entity.createdAt,
  };
}

function validateName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 40) throw new HttpError(400, 'Der Gruppenname muss 1 bis 40 Zeichen lang sein.');
  return name;
}

function assertId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new HttpError(404, 'Nicht gefunden.');
}

async function list(organizationId) {
  const client = await table('orgData');
  const entities = await listAll(client, odata`PartitionKey eq ${organizationId} and RowKey ge ${RANGE.from} and RowKey lt ${RANGE.to}`);
  return entities.map(toGroup).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

async function create(organizationId, input) {
  const name = validateName(input.name);
  const existing = await list(organizationId);
  if (existing.length >= MAX_GROUPS) throw new HttpError(409, `Eine Organisation kann höchstens ${MAX_GROUPS} Gruppen anlegen.`);
  if (existing.some(g => g.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'Eine Gruppe mit diesem Namen gibt es schon.');
  const entity = {
    partitionKey: organizationId,
    rowKey: PREFIX + crypto.randomUUID(),
    name,
    permissions: JSON.stringify(input.permissions ? validatePermissions(input.permissions) : []),
    createdAt: new Date().toISOString(),
  };
  const client = await table('orgData');
  await client.createEntity(entity);
  return toGroup(entity);
}

async function get(organizationId, groupId) {
  assertId(groupId);
  const client = await table('orgData');
  const entity = await getOrNull(client, organizationId, PREFIX + groupId);
  return entity ? { group: toGroup(entity), entity } : null;
}

async function update(organizationId, groupId, input) {
  const found = await get(organizationId, groupId);
  if (!found) throw new HttpError(404, 'Nicht gefunden.');
  const changes = {};
  if (input.name !== undefined) {
    const name = validateName(input.name);
    const others = (await list(organizationId)).filter(g => g.id !== groupId);
    if (others.some(g => g.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'Eine Gruppe mit diesem Namen gibt es schon.');
    changes.name = name;
  }
  if (input.permissions !== undefined) changes.permissions = JSON.stringify(validatePermissions(input.permissions));
  const client = await table('orgData');
  try {
    await client.updateEntity({ partitionKey: organizationId, rowKey: found.entity.rowKey, ...changes }, 'Merge', { etag: found.entity.etag });
  } catch (e) {
    if (isConflict(e)) throw new HttpError(409, 'Die Gruppe wurde gerade geändert. Bitte neu laden.');
    throw e;
  }
  return { before: found.group, after: toGroup({ ...found.entity, ...changes }) };
}

async function remove(organizationId, groupId) {
  const found = await get(organizationId, groupId);
  if (!found) throw new HttpError(404, 'Nicht gefunden.');
  const client = await table('orgData');
  await client.deleteEntity(organizationId, found.entity.rowKey);
  return found.group;
}

// Wirksame Rechte aus Gruppen: Vereinigung der Rechte aller Gruppen des Benutzers.
function inheritedPermissions(userGroups, allGroups) {
  const ids = new Set(userGroups || []);
  return [...new Set(allGroups.filter(g => ids.has(g.id)).flatMap(g => g.permissions))];
}

module.exports = { list, create, get, update, remove, inheritedPermissions, MAX_GROUPS };
