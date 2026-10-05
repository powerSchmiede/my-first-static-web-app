const { readPrincipal } = require('./principal');
const { table, getOrNull } = require('./tables');
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

// Ermittelt Identität, Organisation, Rolle und Status serverseitig für jede Anfrage.
async function resolveContext(request) {
  const principal = readPrincipal(request);
  if (!principal) return { principal: null, isPlatformAdmin: false, membership: null };

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

module.exports = { resolveContext };
