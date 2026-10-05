const crypto = require('crypto');
const { table, getOrNull, listAll, odata } = require('./tables');
const { HttpError } = require('./errors');

const PARTITION = 'org';
const STATUSES = ['Active', 'Disabled'];

function toOrganization(entity) {
  return {
    id: entity.rowKey,
    name: entity.name,
    status: entity.status,
    createdAt: entity.createdAt,
    createdBy: entity.createdBy || '',
  };
}

function validateName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 2 || name.length > 100) throw new HttpError(400, 'Der Name der Organisation muss 2 bis 100 Zeichen lang sein.');
  return name;
}

async function create(name, createdBy) {
  const client = await table('organizations');
  const entity = {
    partitionKey: PARTITION,
    rowKey: crypto.randomUUID(),
    name: validateName(name),
    status: 'Active',
    createdAt: new Date().toISOString(),
    createdBy,
  };
  await client.createEntity(entity);
  return toOrganization(entity);
}

async function getEntity(organizationId) {
  if (!organizationId || typeof organizationId !== 'string') return null;
  const client = await table('organizations');
  return getOrNull(client, PARTITION, organizationId);
}

async function get(organizationId) {
  const entity = await getEntity(organizationId);
  return entity ? toOrganization(entity) : null;
}

async function getOrThrow(organizationId) {
  const organization = await get(organizationId);
  if (!organization) throw new HttpError(404, 'Nicht gefunden.');
  return organization;
}

async function list() {
  const client = await table('organizations');
  const entities = await listAll(client, odata`PartitionKey eq ${PARTITION}`);
  return entities.map(toOrganization).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

async function update(organizationId, patch) {
  const client = await table('organizations');
  const entity = await getOrNull(client, PARTITION, organizationId);
  if (!entity) throw new HttpError(404, 'Nicht gefunden.');
  const changes = {};
  if (patch.name !== undefined) changes.name = validateName(patch.name);
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw new HttpError(400, 'Unbekannter Status.');
    changes.status = patch.status;
  }
  await client.updateEntity({ partitionKey: PARTITION, rowKey: organizationId, ...changes }, 'Merge', { etag: entity.etag });
  return toOrganization({ ...entity, ...changes });
}

module.exports = { create, get, getOrThrow, list, update };
