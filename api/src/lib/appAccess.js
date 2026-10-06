// Freischaltungen von KanzleiMind-Apps je Organisation. Gespeichert in OrgData
// (Partition = OrganizationId), damit sie wie alle Mandantendaten an der Organisation hängen.
//
// Der Plattform-Admin schaltet frei (Eintrag existiert), der Org-Admin entscheidet,
// ob die Benutzer die App sehen (enabled). Neue Freischaltungen starten unsichtbar.
// Einträge ohne enabled stammen aus der Zeit vor dem App-Katalog und gelten als sichtbar.
const { table, getOrNull, listAll, odata } = require('./tables');
const { HttpError } = require('./errors');

const GRANT_PREFIX = 'app_';
const GRANT_RANGE = { from: 'app_', to: 'app`' }; // "_" + 1 = "`"

function assertOrg(organizationId) {
  if (!organizationId || typeof organizationId !== 'string') throw new Error('organizationId fehlt');
}

function toGrant(entity) {
  return { appId: entity.rowKey.slice(GRANT_PREFIX.length), enabled: entity.enabled !== false };
}

async function listGrants(organizationId) {
  assertOrg(organizationId);
  const client = await table('orgData');
  const entities = await listAll(client, odata`PartitionKey eq ${organizationId} and RowKey ge ${GRANT_RANGE.from} and RowKey lt ${GRANT_RANGE.to}`);
  return entities.map(toGrant);
}

async function listGrantedAppIds(organizationId) {
  return (await listGrants(organizationId)).map(grant => grant.appId);
}

async function getGrant(organizationId, appId) {
  assertOrg(organizationId);
  if (!appId || typeof appId !== 'string') return null;
  const client = await table('orgData');
  const entity = await getOrNull(client, organizationId, GRANT_PREFIX + appId);
  return entity ? toGrant(entity) : null;
}

// Setzt die Freischaltungen auf genau die übergebene Liste und liefert die Änderungen zurück.
// Bestehende Freischaltungen behalten ihre Sichtbarkeit.
async function setGrantedAppIds(organizationId, appIds, grantedBy) {
  const client = await table('orgData');
  const current = new Set(await listGrantedAppIds(organizationId));
  const wanted = new Set(appIds);
  const added = [...wanted].filter(id => !current.has(id));
  const removed = [...current].filter(id => !wanted.has(id));
  const now = new Date().toISOString();
  for (const appId of added) {
    await client.upsertEntity({ partitionKey: organizationId, rowKey: GRANT_PREFIX + appId, appId, grantedBy, grantedAt: now, enabled: false }, 'Replace');
  }
  for (const appId of removed) {
    await client.deleteEntity(organizationId, GRANT_PREFIX + appId).catch(e => { if (e.statusCode !== 404) throw e; });
  }
  return { added, removed };
}

// Org-Admin schaltet eine freigeschaltete App für seine Benutzer sichtbar oder unsichtbar.
async function setGrantEnabled(organizationId, appId, enabled) {
  assertOrg(organizationId);
  const client = await table('orgData');
  const entity = typeof appId === 'string' ? await getOrNull(client, organizationId, GRANT_PREFIX + appId) : null;
  if (!entity) throw new HttpError(404, 'Nicht gefunden.');
  await client.updateEntity({ partitionKey: organizationId, rowKey: entity.rowKey, enabled: enabled === true }, 'Merge');
  return toGrant({ ...entity, enabled: enabled === true });
}

// Beim Löschen einer App alle Freischaltungen entfernen, damit eine spätere App mit
// gleicher ID nicht versehentlich freigeschaltet ist.
async function removeAppEverywhere(appId, organizationIds) {
  const client = await table('orgData');
  for (const organizationId of organizationIds) {
    await client.deleteEntity(organizationId, GRANT_PREFIX + appId).catch(e => { if (e.statusCode !== 404) throw e; });
  }
}

module.exports = { listGrants, listGrantedAppIds, getGrant, setGrantedAppIds, setGrantEnabled, removeAppEverywhere };
