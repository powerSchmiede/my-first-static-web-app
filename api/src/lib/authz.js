const { HttpError, AccessDenied } = require('./errors');

// Rollen innerhalb einer Organisation. Der Rang bestimmt, welche Rollen jemand vergeben darf.
const ROLES = {
  OrgAdmin: { rank: 2, label: 'Organization Admin' },
  OrgUser: { rank: 1, label: 'Organization User' },
};

// Berechtigungen je Rolle. Erweiterbar um weitere Rollen und Rechte.
const PERMISSIONS = {
  'org.read': ['OrgAdmin'],
  'org.update': ['OrgAdmin'],
  'users.read': ['OrgAdmin'],
  'users.manage': ['OrgAdmin'],
  'invitations.manage': ['OrgAdmin'],
  'audit.read': ['OrgAdmin'],
  'apps.use': ['OrgAdmin', 'OrgUser'],
  'catalog.manage': ['OrgAdmin'],
};

function isValidRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, role);
}

function requireAuthenticated(ctx) {
  if (!ctx.principal) throw new HttpError(401, 'Bitte anmelden.');
}

function requirePlatformAdmin(ctx) {
  requireAuthenticated(ctx);
  if (!ctx.isPlatformAdmin) {
    throw new AccessDenied(403, 'Diese Aktion ist Plattform-Admins vorbehalten.', { reason: 'not_platform_admin' });
  }
}

// Prüft Mandant, Status und Rolle. Die Organisation des Benutzers stammt immer aus dem
// serverseitig ermittelten Kontext, nie aus der Anfrage.
function authorizeOrg(ctx, organizationId, permission) {
  requireAuthenticated(ctx);
  if (!PERMISSIONS[permission]) throw new Error(`Unbekannte Berechtigung: ${permission}`);
  if (ctx.isPlatformAdmin) return;

  const membership = ctx.membership;
  if (!membership || membership.organizationId !== organizationId) {
    // 404 statt 403: Fremde Organisationen werden nicht bestätigt.
    throw new AccessDenied(404, 'Nicht gefunden.', { reason: 'foreign_organization', requestedOrganizationId: organizationId });
  }
  if (membership.orgStatus !== 'Active') {
    throw new AccessDenied(403, 'Deine Organisation ist deaktiviert.', { reason: 'organization_disabled' });
  }
  if (membership.status !== 'Active') {
    throw new AccessDenied(403, 'Dein Konto ist deaktiviert.', { reason: 'user_disabled' });
  }
  if (!PERMISSIONS[permission].includes(membership.role)) {
    throw new AccessDenied(403, 'Dafür fehlt dir die Berechtigung.', { reason: 'missing_permission', permission });
  }
}

// Darf der Akteur einem Benutzer die gewünschte Rolle geben?
function assertCanAssignRole(ctx, role) {
  if (!isValidRole(role)) throw new HttpError(400, 'Unbekannte Rolle.');
  if (ctx.isPlatformAdmin) return;
  const own = ROLES[ctx.membership.role];
  if (!own || ROLES[role].rank > own.rank) {
    throw new AccessDenied(403, 'Diese Rolle darfst du nicht vergeben.', { reason: 'role_escalation', role });
  }
}

module.exports = { ROLES, PERMISSIONS, isValidRole, requireAuthenticated, requirePlatformAdmin, authorizeOrg, assertCanAssignRole };
