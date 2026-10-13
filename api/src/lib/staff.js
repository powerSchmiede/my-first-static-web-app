// Kanzlei-Mitarbeitende und ihre Mandanten-Zuordnung.
//
// Mitarbeitende melden sich mit ihrem Microsoft-365-Konto an (Anmeldename = E-Mail, Domain
// im Kanzlei-Tenant verifiziert). Sie gehören keiner Organisation an, sondern betreuen die
// ihnen zugeordneten Mandanten. Der Plattform-Admin pflegt Mitarbeitende und Zuordnungen.
//
// Zuordnungen tragen eine Quelle ("manual", später z. B. "datev" oder "dataverse"), damit ein
// täglicher Abgleich mit DATEV oder einer Dataverse-Tabelle sie automatisch pflegen kann.

const { table, getOrNull, listAll, odata } = require('./tables');
const { HttpError } = require('./errors');
const { normalizeEmail } = require('./principal');

const SOURCES = ['manual', 'datev', 'dataverse'];

function toStaff(entity) {
  return { email: entity.partitionKey, name: entity.name || '', active: entity.active !== false, createdAt: entity.createdAt };
}

async function list() {
  const client = await table('staff');
  return (await listAll(client, odata`RowKey eq 'staff'`)).map(toStaff).sort((a, b) => a.email.localeCompare(b.email));
}

async function get(email) {
  const client = await table('staff');
  const entity = email ? await getOrNull(client, email, 'staff') : null;
  return entity ? toStaff(entity) : null;
}

async function upsert({ email, name, active }, createdBy) {
  const address = normalizeEmail(email);
  if (!address) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse eingeben.');
  const client = await table('staff');
  const existing = await getOrNull(client, address, 'staff');
  await client.upsertEntity({
    partitionKey: address,
    rowKey: 'staff',
    name: typeof name === 'string' ? name.trim().slice(0, 120) : (existing ? existing.name : ''),
    active: active === undefined ? (existing ? existing.active !== false : true) : active === true,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    createdBy: existing ? existing.createdBy : createdBy,
  }, 'Merge');
  return get(address);
}

async function remove(email) {
  const client = await table('staff');
  await client.deleteEntity(email, 'staff').catch(e => { if (e.statusCode !== 404) throw e; });
  await setAssignments(email, [], null);
}

async function assignments(email) {
  const client = await table('staffAssignments');
  return (await listAll(client, odata`PartitionKey eq ${email}`)).map(e => ({ organizationId: e.rowKey, source: e.source || 'manual' }));
}

// Alle Mitarbeitenden, die einem Mandanten zugeordnet sind (für Benachrichtigungen).
async function staffForOrganization(organizationId) {
  const client = await table('staffAssignments');
  return (await listAll(client, odata`RowKey eq ${organizationId}`)).map(e => e.partitionKey);
}

async function setAssignments(email, organizationIds, assignedBy, source = 'manual') {
  if (!SOURCES.includes(source)) throw new HttpError(400, 'Unbekannte Quelle.');
  const client = await table('staffAssignments');
  const current = await assignments(email);
  const wanted = new Set(organizationIds);
  for (const entry of current) {
    if (!wanted.has(entry.organizationId)) await client.deleteEntity(email, entry.organizationId).catch(e => { if (e.statusCode !== 404) throw e; });
  }
  for (const organizationId of wanted) {
    if (!current.some(c => c.organizationId === organizationId)) {
      await client.upsertEntity({ partitionKey: email, rowKey: organizationId, source, assignedBy, assignedAt: new Date().toISOString() }, 'Replace');
    }
  }
  return assignments(email);
}

async function removeOrganizationEverywhere(organizationId) {
  const client = await table('staffAssignments');
  for (const email of await staffForOrganization(organizationId)) {
    await client.deleteEntity(email, organizationId).catch(e => { if (e.statusCode !== 404) throw e; });
  }
}

// Für den Login-Kontext: Mitarbeitende nur mit Microsoft-365-Anmeldung und aktivem Eintrag.
async function resolve(principal) {
  if (!principal || principal.kind !== 'm365' || !principal.email) return null;
  const entry = await get(principal.email);
  if (!entry || !entry.active) return null;
  const assigned = await assignments(entry.email);
  return { email: entry.email, name: entry.name, organizationIds: assigned.map(a => a.organizationId) };
}

module.exports = { list, get, upsert, remove, assignments, setAssignments, staffForOrganization, removeOrganizationEverywhere, resolve };
