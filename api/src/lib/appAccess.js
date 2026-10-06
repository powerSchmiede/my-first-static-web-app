// App-Freigaben je Organisation. Gespeichert in OrgData (Partition = OrganizationId),
// damit sie wie alle Mandantendaten an der Organisation hängen.
const { table, getOrNull, listAll, odata } = require('./tables');

const GRANT_PREFIX = 'app_';
const GRANT_RANGE = { from: 'app_', to: 'app`' }; // "_" + 1 = "`"

function assertOrg(organizationId) {
  if (!organizationId || typeof organizationId !== 'string') throw new Error('organizationId fehlt');
}

async function listGrantedAppIds(organizationId) {
  assertOrg(organizationId);
  const client = await table('orgData');
  const entities = await listAll(client, odata`PartitionKey eq ${organizationId} and RowKey ge ${GRANT_RANGE.from} and RowKey lt ${GRANT_RANGE.to}`);
  return entities.map(entity => entity.rowKey.slice(GRANT_PREFIX.length));
}

async function hasGrant(organizationId, appId) {
  assertOrg(organizationId);
  if (!appId || typeof appId !== 'string') return false;
  const client = await table('orgData');
  return !!(await getOrNull(client, organizationId, GRANT_PREFIX + appId));
}

// Setzt die Freigaben auf genau die übergebene Liste und liefert die Änderungen zurück.
async function setGrantedAppIds(organizationId, appIds, grantedBy) {
  const client = await table('orgData');
  const current = new Set(await listGrantedAppIds(organizationId));
  const wanted = new Set(appIds);
  const added = [...wanted].filter(id => !current.has(id));
  const removed = [...current].filter(id => !wanted.has(id));
  const now = new Date().toISOString();
  for (const appId of added) {
    await client.upsertEntity({ partitionKey: organizationId, rowKey: GRANT_PREFIX + appId, appId, grantedBy, grantedAt: now }, 'Replace');
  }
  for (const appId of removed) {
    await client.deleteEntity(organizationId, GRANT_PREFIX + appId).catch(e => { if (e.statusCode !== 404) throw e; });
  }
  return { added, removed };
}

// Beim Löschen einer App alle Freigaben entfernen, damit eine spätere App mit
// gleicher ID nicht versehentlich freigegeben ist.
async function removeAppEverywhere(appId, organizationIds) {
  const client = await table('orgData');
  for (const organizationId of organizationIds) {
    await client.deleteEntity(organizationId, GRANT_PREFIX + appId).catch(e => { if (e.statusCode !== 404) throw e; });
  }
}

module.exports = { listGrantedAppIds, hasGrant, setGrantedAppIds, removeAppEverywhere };
