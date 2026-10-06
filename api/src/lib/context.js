const { readPrincipal } = require('./principal');
const { table, getOrNull, listAll, odata } = require('./tables');
const organizations = require('./organizations');
const members = require('./members');
const audit = require('./audit');

const LAST_LOGIN_INTERVAL_MS = 5 * 60 * 1000;

function bootstrapEmails() {
  return (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

async function resolvePlatformAdmin(principal) {
  const admins = await table('platformAdmins');
  if (await getOrNull(admins, principal.identityId, 'platform')) return true;

  // Erstes Einrichten: In PLATFORM_ADMIN_EMAILS hinterlegte Adressen werden beim
  // ersten Login dauerhaft als Plattform-Admin registriert.
  if (principal.email && bootstrapEmails().includes(principal.email)) {
    await admins.upsertEntity({
      partitionKey: principal.identityId,
      rowKey: 'platform',
      email: principal.email,
      createdAt: new Date().toISOString(),
    });
    await audit.record({ principal }, { action: 'platform_admin.registered', targetType: 'identity', targetId: principal.identityId });
    return true;
  }
  return false;
}

// Bis Oktober 2026 liefen KanzleiMind-Konten über den Anbieter "aad" mit dem Schlüssel
// "aad|<userId>". Heute steht "aad" für Microsoft 365, KanzleiMind-Konten heißen
// "ciam|<email>". Alle alten "aad|"-Einträge stammen aus dem KanzleiMind-Verzeichnis
// und werden einmalig auf den neuen Schlüssel umgestellt.
const LEGACY_PREFIX = { from: 'aad|', to: 'aad}' }; // "|" + 1 = "}"
const MIGRATION_MARKER = { partitionKey: '_meta', rowKey: 'migration-ciam-v1' };
let migration;

async function migrateLegacyIdentities() {
  const identities = await table('identities');
  const admins = await table('platformAdmins');
  const orgData = await table('orgData');
  const filter = odata`PartitionKey ge ${LEGACY_PREFIX.from} and PartitionKey lt ${LEGACY_PREFIX.to}`;

  for (const entry of await listAll(identities, filter)) {
    const user = await getOrNull(orgData, entry.organizationId, `user_${entry.userId}`);
    if (user && user.email) {
      const identityId = `ciam|${user.email}`;
      await identities.upsertEntity({ partitionKey: identityId, rowKey: 'membership', organizationId: entry.organizationId, userId: entry.userId }, 'Replace');
      if (user.identityId === entry.partitionKey) {
        await orgData.updateEntity({ partitionKey: user.partitionKey, rowKey: user.rowKey, identityId }, 'Merge');
      }
    }
    await identities.deleteEntity(entry.partitionKey, entry.rowKey).catch(() => {});
  }

  for (const entry of await listAll(admins, filter)) {
    if (entry.email) {
      await admins.upsertEntity({ partitionKey: `ciam|${entry.email}`, rowKey: 'platform', email: entry.email, createdAt: entry.createdAt }, 'Replace');
    }
    await admins.deleteEntity(entry.partitionKey, entry.rowKey).catch(() => {});
  }
  await identities.upsertEntity({ ...MIGRATION_MARKER, completedAt: new Date().toISOString() });
}

function ensureMigrated() {
  if (!migration) {
    migration = (async () => {
      const identities = await table('identities');
      if (await getOrNull(identities, MIGRATION_MARKER.partitionKey, MIGRATION_MARKER.rowKey)) return;
      await migrateLegacyIdentities();
    })();
    migration.catch(() => { migration = undefined; });
  }
  return migration;
}

// Ermittelt Identität, Organisation, Rolle und Status serverseitig für jede Anfrage.
async function resolveContext(request) {
  const principal = readPrincipal(request);
  if (!principal) return { principal: null, isPlatformAdmin: false, membership: null };
  await ensureMigrated();

  const isPlatformAdmin = await resolvePlatformAdmin(principal);

  let membership = null;
  const index = await members.findMembership(principal.identityId);
  if (index) {
    const [user, organization] = await Promise.all([
      members.getUser(index.organizationId, index.userId),
      organizations.get(index.organizationId),
    ]);
    if (user && organization && user.identityId === principal.identityId) {
      membership = {
        organizationId: organization.id,
        organizationName: organization.name,
        orgStatus: organization.status,
        userId: user.id,
        role: user.role,
        status: user.status,
      };
      const last = user.lastLoginAt ? Date.parse(user.lastLoginAt) : 0;
      if (Date.now() - last > LAST_LOGIN_INTERVAL_MS) {
        await members.updateUser(organization.id, user.id, { lastLoginAt: new Date().toISOString() }).catch(() => {});
      }
    }
  }

  return { principal, isPlatformAdmin, membership };
}

module.exports = { resolveContext, migrateLegacyIdentities };
