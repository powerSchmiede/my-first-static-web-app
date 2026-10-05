const { TableClient, odata } = require('@azure/data-tables');
const { HttpError } = require('./errors');

const TABLE_NAMES = {
  organizations: 'Organizations',
  orgData: 'OrgData', // Benutzer und Einladungen, Partition = OrganizationId
  identities: 'IdentityIndex', // Login-Identität -> Organisation, erzwingt genau eine Organisation pro Benutzer
  invitationTokens: 'InvitationTokens',
  audit: 'AuditLog', // Partition = OrganizationId bzw. "_platform"
  platformAdmins: 'PlatformAdmins',
};

const clients = {};
const created = {};

function connectionString() {
  const value = process.env.STORAGE_CONNECTION_STRING;
  if (!value) throw new HttpError(500, 'STORAGE_CONNECTION_STRING ist nicht konfiguriert.');
  return value;
}

async function table(key) {
  const name = TABLE_NAMES[key];
  if (!name) throw new Error(`Unbekannte Tabelle: ${key}`);
  if (!clients[key]) {
    clients[key] = TableClient.fromConnectionString(connectionString(), name, { allowInsecureConnection: true });
  }
  if (!created[key]) {
    created[key] = clients[key].createTable().catch(e => {
      if (e.statusCode !== 409) {
        created[key] = undefined;
        throw e;
      }
    });
  }
  await created[key];
  return clients[key];
}

async function getOrNull(client, partitionKey, rowKey) {
  try {
    return await client.getEntity(partitionKey, rowKey);
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
}

async function listAll(client, filter) {
  const items = [];
  for await (const entity of client.listEntities({ queryOptions: { filter } })) items.push(entity);
  return items;
}

const isConflict = e => e && (e.statusCode === 409 || e.statusCode === 412);

module.exports = { table, getOrNull, listAll, odata, isConflict };
