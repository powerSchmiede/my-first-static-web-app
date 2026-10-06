const { HttpError, AccessDenied } = require('./errors');
const { normalizeEmail } = require('./principal');
const { authorizeOrg, requirePlatformAdmin, assertCanAssignRole, requireAuthenticated, isValidRole } = require('./authz');
const organizations = require('./organizations');
const members = require('./members');
const audit = require('./audit');
const email = require('./email');
const store = require('./store');
const appAccess = require('./appAccess');
const catalog = require('./catalog');

const INVITES_PER_HOUR = 50;

function actorName(ctx) {
  return ctx.principal.name || ctx.principal.email;
}

function requireEmail(value) {
  const address = normalizeEmail(value);
  if (!address) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse eingeben.');
  return address;
}

async function activeAdminCount(organizationId) {
  const users = await members.listUsers(organizationId);
  return users.filter(u => u.role === 'OrgAdmin' && u.status === 'Active').length;
}

// ---------- Organisation ----------

async function getOrganization(ctx, organizationId) {
  authorizeOrg(ctx, organizationId, 'org.read');
  const organization = await organizations.getOrThrow(organizationId);
  const [users, invitations] = await Promise.all([members.listUsers(organizationId), members.listInvitations(organizationId)]);
  return {
    ...organization,
    stats: {
      users: users.length,
      activeUsers: users.filter(u => u.status === 'Active').length,
      disabledUsers: users.filter(u => u.status === 'Disabled').length,
      admins: users.filter(u => u.role === 'OrgAdmin').length,
      pendingInvitations: invitations.filter(i => i.status === 'Pending').length,
      expiredInvitations: invitations.filter(i => i.status === 'Expired').length,
    },
  };
}

async function renameOrganization(ctx, organizationId, name) {
  authorizeOrg(ctx, organizationId, 'org.update');
  const before = await organizations.getOrThrow(organizationId);
  const updated = await organizations.update(organizationId, { name });
  await audit.record(ctx, { organizationId, action: 'organization.renamed', targetType: 'organization', targetId: organizationId, details: { from: before.name, to: updated.name } });
  return updated;
}

// ---------- Benutzer ----------

async function listUsers(ctx, organizationId) {
  authorizeOrg(ctx, organizationId, 'users.read');
  await organizations.getOrThrow(organizationId);
  return members.listUsers(organizationId);
}

async function updateUser(ctx, organizationId, userId, patch) {
  authorizeOrg(ctx, organizationId, 'users.manage');
  const user = await members.getUser(organizationId, userId);
  if (!user) throw new HttpError(404, 'Nicht gefunden.');

  const isSelf = ctx.membership && ctx.membership.userId === userId && ctx.membership.organizationId === organizationId;
  if (isSelf && !ctx.isPlatformAdmin) {
    throw new AccessDenied(403, 'Deine eigene Rolle und deinen eigenen Status kann nur ein anderer Admin ändern.', { reason: 'self_change' });
  }

  const changes = {};
  if (patch.role !== undefined && patch.role !== user.role) {
    assertCanAssignRole(ctx, patch.role);
    changes.role = patch.role;
  }
  if (patch.status !== undefined && patch.status !== user.status) {
    if (!['Active', 'Disabled'].includes(patch.status)) throw new HttpError(400, 'Unbekannter Status.');
    changes.status = patch.status;
  }
  if (!Object.keys(changes).length) return user;

  const losesAdmin = user.role === 'OrgAdmin' && user.status === 'Active' && (changes.role && changes.role !== 'OrgAdmin' || changes.status === 'Disabled');
  if (losesAdmin && (await activeAdminCount(organizationId)) <= 1) {
    throw new HttpError(409, 'Die Organisation braucht mindestens einen aktiven Organization Admin.');
  }

  const updated = await members.updateUser(organizationId, userId, changes);
  if (changes.role) {
    await audit.record(ctx, { organizationId, action: 'user.role_changed', targetType: 'user', targetId: userId, details: { email: user.email, from: user.role, to: changes.role } });
  }
  if (changes.status) {
    await audit.record(ctx, { organizationId, action: changes.status === 'Disabled' ? 'user.disabled' : 'user.enabled', targetType: 'user', targetId: userId, details: { email: user.email } });
  }
  return updated;
}

async function removeUser(ctx, organizationId, userId) {
  authorizeOrg(ctx, organizationId, 'users.manage');
  const user = await members.getUser(organizationId, userId);
  if (!user) throw new HttpError(404, 'Nicht gefunden.');
  const isSelf = ctx.membership && ctx.membership.userId === userId && ctx.membership.organizationId === organizationId;
  if (isSelf && !ctx.isPlatformAdmin) {
    throw new AccessDenied(403, 'Du kannst dich nicht selbst entfernen.', { reason: 'self_change' });
  }
  if (user.role === 'OrgAdmin' && user.status === 'Active' && (await activeAdminCount(organizationId)) <= 1) {
    throw new HttpError(409, 'Die Organisation braucht mindestens einen aktiven Organization Admin.');
  }
  await members.deleteUser(organizationId, userId);
  await catalog.purgeUser(organizationId, userId);
  await audit.record(ctx, { organizationId, action: 'user.removed', targetType: 'user', targetId: userId, details: { email: user.email, role: user.role } });
}

// ---------- Einladungen ----------

async function listInvitations(ctx, organizationId) {
  authorizeOrg(ctx, organizationId, 'invitations.manage');
  await organizations.getOrThrow(organizationId);
  return members.listInvitations(organizationId);
}

async function deliver(ctx, organization, invitation, token) {
  const delivery = await email.sendInvitation({
    to: invitation.email,
    organizationName: organization.name,
    role: invitation.role,
    inviterName: actorName(ctx),
    token,
    expiresAt: invitation.expiresAt,
  });
  return { invitation, inviteLink: email.invitationLink(token), emailSent: delivery.sent, emailStatus: delivery.reason || 'sent' };
}

async function invite(ctx, organizationId, input) {
  authorizeOrg(ctx, organizationId, 'invitations.manage');
  const organization = await organizations.getOrThrow(organizationId);
  if (organization.status !== 'Active') throw new HttpError(409, 'Die Organisation ist deaktiviert.');
  const address = requireEmail(input.email);
  const role = input.role || 'OrgUser';
  assertCanAssignRole(ctx, role);

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  if ((await members.countRecentInvitations(organizationId, since)) >= INVITES_PER_HOUR) {
    throw new HttpError(429, 'Zu viele Einladungen in kurzer Zeit. Bitte später erneut versuchen.');
  }

  const { invitation, token } = await members.createInvitation(organizationId, { email: address, role, invitedBy: ctx.principal.email || ctx.principal.identityId });
  const result = await deliver(ctx, organization, invitation, token);
  await audit.record(ctx, { organizationId, action: 'invitation.created', targetType: 'invitation', targetId: invitation.id, details: { email: address, role, emailSent: result.emailSent } });
  return result;
}

async function resendInvitation(ctx, organizationId, invitationId) {
  authorizeOrg(ctx, organizationId, 'invitations.manage');
  const organization = await organizations.getOrThrow(organizationId);
  const { invitation, token } = await members.renewInvitation(organizationId, invitationId);
  const result = await deliver(ctx, organization, invitation, token);
  await audit.record(ctx, { organizationId, action: 'invitation.resent', targetType: 'invitation', targetId: invitationId, details: { email: invitation.email, emailSent: result.emailSent } });
  return result;
}

async function revokeInvitation(ctx, organizationId, invitationId) {
  authorizeOrg(ctx, organizationId, 'invitations.manage');
  const invitation = await members.revokeInvitation(organizationId, invitationId);
  await audit.record(ctx, { organizationId, action: 'invitation.revoked', targetType: 'invitation', targetId: invitationId, details: { email: invitation.email } });
  return invitation;
}

async function previewInvitation(token) {
  const entity = await members.findInvitationByToken(token);
  if (!entity) throw new HttpError(404, 'Diese Einladung ist ungültig oder wurde bereits verwendet.');
  const organization = await organizations.get(entity.partitionKey);
  if (!organization) throw new HttpError(404, 'Diese Einladung ist ungültig oder wurde bereits verwendet.');
  const status = members.invitationState(entity);
  return { organizationName: organization.name, email: entity.email, role: entity.role, status, expiresAt: entity.expiresAt };
}

async function acceptInvitation(ctx, token) {
  requireAuthenticated(ctx);
  const preview = await members.findInvitationByToken(token);
  if (preview) {
    const organization = await organizations.get(preview.partitionKey);
    if (!organization || organization.status !== 'Active') throw new HttpError(409, 'Die Organisation ist deaktiviert.');
  }
  try {
    const { user, invitation } = await members.acceptInvitation(token, ctx.principal);
    await audit.record(ctx, { organizationId: user.organizationId, action: 'invitation.accepted', targetType: 'user', targetId: user.id, details: { email: user.email, role: user.role, invitationId: invitation.id } });
    return { organizationId: user.organizationId, role: user.role };
  } catch (e) {
    if (preview) {
      await audit.record(ctx, { organizationId: preview.partitionKey, action: 'invitation.accept_failed', targetType: 'invitation', targetId: preview.rowKey, result: 'failed', details: { reason: e.code || e.message, email: ctx.principal.email } });
    }
    throw e;
  }
}

// ---------- Plattform ----------

async function listOrganizations(ctx) {
  requirePlatformAdmin(ctx);
  const all = await organizations.list();
  return Promise.all(all.map(async organization => {
    const [users, invitations] = await Promise.all([members.listUsers(organization.id), members.listInvitations(organization.id)]);
    return {
      ...organization,
      stats: {
        users: users.length,
        activeUsers: users.filter(u => u.status === 'Active').length,
        pendingInvitations: invitations.filter(i => i.status === 'Pending').length,
      },
    };
  }));
}

async function createOrganization(ctx, input) {
  requirePlatformAdmin(ctx);
  const adminEmail = requireEmail(input.adminEmail);
  const appIds = input.appIds === undefined ? [] : await validAppIds(input.appIds);
  const organization = await organizations.create(input.name, ctx.principal.email || ctx.principal.identityId);
  await audit.record(ctx, { organizationId: organization.id, action: 'organization.created', targetType: 'organization', targetId: organization.id, details: { name: organization.name } });
  await audit.record(ctx, { action: 'organization.created', targetType: 'organization', targetId: organization.id, details: { name: organization.name } });
  const { invitation, token } = await members.createInvitation(organization.id, { email: adminEmail, role: 'OrgAdmin', invitedBy: ctx.principal.email || ctx.principal.identityId });
  const result = await deliver(ctx, organization, invitation, token);
  await audit.record(ctx, { organizationId: organization.id, action: 'invitation.created', targetType: 'invitation', targetId: invitation.id, details: { email: adminEmail, role: 'OrgAdmin', emailSent: result.emailSent } });
  if (appIds.length) await applyAppGrants(ctx, organization, appIds);
  return { organization, ...result };
}

async function setOrganizationStatus(ctx, organizationId, status) {
  requirePlatformAdmin(ctx);
  const updated = await organizations.update(organizationId, { status });
  const action = status === 'Disabled' ? 'organization.disabled' : 'organization.enabled';
  await audit.record(ctx, { organizationId, action, targetType: 'organization', targetId: organizationId });
  await audit.record(ctx, { action, targetType: 'organization', targetId: organizationId, details: { name: updated.name } });
  return updated;
}

// Endgültiges Löschen: nur deaktivierte Organisationen und nur mit Bestätigung des Namens.
// Reihenfolge: erst Zuordnungen und Daten, zuletzt die Organisation selbst. Bricht ein Lauf
// ab, bleibt die (deaktivierte) Organisation bestehen und das Löschen kann wiederholt werden.
async function deleteOrganization(ctx, organizationId, confirmName) {
  requirePlatformAdmin(ctx);
  const organization = await organizations.getOrThrow(organizationId);
  if (organization.status !== 'Disabled') {
    throw new HttpError(409, 'Bitte deaktiviere die Organisation, bevor du sie löschst.', 'organization_active');
  }
  if (typeof confirmName !== 'string' || confirmName.trim() !== organization.name) {
    throw new HttpError(400, 'Der eingegebene Name stimmt nicht mit der Organisation überein.', 'confirm_mismatch');
  }

  const counts = await members.purgeOrganization(organizationId);
  const auditEntries = await audit.purgeOrganization(organizationId);
  await organizations.remove(organizationId);
  await audit.record(ctx, {
    action: 'organization.deleted',
    targetType: 'organization',
    targetId: organizationId,
    details: { name: organization.name, users: counts.users, invitations: counts.invitations, auditEntries },
  });
}

async function listAudit(ctx, organizationId) {
  authorizeOrg(ctx, organizationId, 'audit.read');
  await organizations.getOrThrow(organizationId);
  return audit.list(organizationId);
}

async function listPlatformAudit(ctx) {
  requirePlatformAdmin(ctx);
  return audit.list(audit.PLATFORM_PARTITION);
}

// ---------- Apps und Freigaben ----------

// Prüft, dass alle IDs zu existierenden Apps gehören. Liefert die Liste ohne Duplikate.
async function validAppIds(value) {
  if (!Array.isArray(value) || value.length > 500 || value.some(id => typeof id !== 'string')) {
    throw new HttpError(400, 'Ungültige App-Auswahl.');
  }
  const known = new Set((await store.listApps()).map(app => app.id));
  const unique = [...new Set(value)];
  if (unique.some(id => !known.has(id))) throw new HttpError(400, 'Mindestens eine ausgewählte App gibt es nicht mehr.');
  return unique;
}

async function applyAppGrants(ctx, organization, appIds) {
  const { added, removed } = await appAccess.setGrantedAppIds(organization.id, appIds, ctx.principal.email || ctx.principal.identityId);
  if (!added.length && !removed.length) return { added, removed };
  const titles = new Map((await store.listApps()).map(app => [app.id, app.title]));
  const details = { name: organization.name, added: added.map(id => titles.get(id) || id), removed: removed.map(id => titles.get(id) || id) };
  await audit.record(ctx, { organizationId: organization.id, action: 'organization.apps_changed', targetType: 'organization', targetId: organization.id, details });
  await audit.record(ctx, { action: 'organization.apps_changed', targetType: 'organization', targetId: organization.id, details });
  return { added, removed };
}

// Aktive Mitgliedschaft aus dem Login-Kontext. Die Organisation stammt nie aus der Anfrage.
function activeMembership(ctx) {
  const m = ctx.membership;
  return m && m.status === 'Active' && m.orgStatus === 'Active' ? m : null;
}

function requireMember(ctx) {
  requireAuthenticated(ctx);
  if (!ctx.membership) throw new AccessDenied(403, 'Nur für Mitglieder einer Organisation.', { reason: 'no_membership' });
  authorizeOrg(ctx, ctx.membership.organizationId, 'apps.use');
  const m = activeMembership(ctx);
  if (!m) throw new AccessDenied(403, 'Dein Zugang ist deaktiviert.', { reason: 'inactive' });
  return m;
}

// Stellt die Apps eines Benutzers zusammen: freigeschaltete und sichtbar geschaltete
// KanzleiMind-Apps, sichtbare Apps der Organisation und eigene Apps, sortiert nach den
// persönlichen Einstellungen. Schlüssel: p-<id>, o-<id>, u-<id>.
async function composeApps(membership, { includeHidden = false } = {}) {
  const { organizationId, userId } = membership;
  const [platformApps, grants, orgApps, userApps, prefs] = await Promise.all([
    store.listApps(),
    appAccess.listGrants(organizationId),
    catalog.listOrgApps(organizationId),
    catalog.listUserApps(organizationId, userId),
    catalog.getPrefs(organizationId, userId),
  ]);
  const visible = new Map(grants.map(g => [g.appId, g.enabled]));
  const platform = platformApps.filter(app => visible.get(app.id) === true).map(app => ({ ...app, key: `p-${app.id}`, source: 'platform' }));
  const strip = ({ enabled, ...app }) => app;
  const candidates = [
    ...platform.filter(app => app.type !== 'none'),
    ...orgApps.filter(app => app.enabled).map(app => ({ ...strip(app), key: `o-${app.id}`, source: 'org' })),
    ...userApps.map(app => ({ ...strip(app), key: `u-${app.id}`, source: 'user' })),
    ...platform.filter(app => app.type === 'none'),
  ];
  const position = new Map(prefs.order.map((key, index) => [key, index]));
  const ordered = candidates
    .map((app, index) => ({ app, rank: position.has(app.key) ? position.get(app.key) : prefs.order.length + index }))
    .sort((a, b) => a.rank - b.rank)
    .map(entry => entry.app);
  const hidden = new Set(prefs.hidden);
  return includeHidden
    ? ordered.map(app => ({ ...app, hidden: hidden.has(app.key) }))
    : ordered.filter(app => !hidden.has(app.key));
}

async function listVisibleApps(ctx) {
  requireAuthenticated(ctx);
  const membership = activeMembership(ctx);
  if (membership) return composeApps(membership);
  if (ctx.isPlatformAdmin) {
    return (await store.listApps()).map(app => ({ ...app, key: `p-${app.id}`, source: 'platform' }));
  }
  return [];
}

// HTML-Apps nur bei Freischaltung. Benutzer zusätzlich nur, wenn der Org-Admin die App
// sichtbar geschaltet hat; Org-Admins dürfen freigeschaltete Apps vorab testen.
async function readAppHtml(ctx, appId) {
  requireAuthenticated(ctx);
  if (!ctx.isPlatformAdmin) {
    const membership = ctx.membership;
    if (!membership) throw new AccessDenied(404, 'Nicht gefunden.', { reason: 'no_membership', appId });
    authorizeOrg(ctx, membership.organizationId, 'apps.use');
    const grant = await appAccess.getGrant(membership.organizationId, appId);
    if (!grant || (!grant.enabled && membership.role !== 'OrgAdmin')) {
      throw new AccessDenied(404, 'Nicht gefunden.', { reason: 'app_not_granted', appId });
    }
  }
  return store.readHtml(appId);
}

// ---------- Persönliche Apps und Einstellungen ----------

async function myApps(ctx) {
  const membership = requireMember(ctx);
  return { apps: await composeApps(membership, { includeHidden: true }), maxOwnApps: catalog.MAX_USER_APPS };
}

async function saveMyAppSettings(ctx, input) {
  const membership = requireMember(ctx);
  return catalog.setPrefs(membership.organizationId, membership.userId, input || {});
}

async function createMyApp(ctx, input) {
  const membership = requireMember(ctx);
  return catalog.createUserApp(membership.organizationId, membership.userId, input || {});
}

async function updateMyApp(ctx, appId, input) {
  const membership = requireMember(ctx);
  return catalog.updateUserApp(membership.organizationId, membership.userId, appId, input || {});
}

async function deleteMyApp(ctx, appId) {
  const membership = requireMember(ctx);
  await catalog.deleteUserApp(membership.organizationId, membership.userId, appId);
}

// ---------- App-Katalog der Organisation ----------

async function getCatalog(ctx, organizationId) {
  authorizeOrg(ctx, organizationId, 'catalog.manage');
  await organizations.getOrThrow(organizationId);
  const [platformApps, grants, orgApps] = await Promise.all([
    store.listApps(),
    appAccess.listGrants(organizationId),
    catalog.listOrgApps(organizationId),
  ]);
  const enabled = new Map(grants.map(g => [g.appId, g.enabled]));
  return {
    platformApps: platformApps.filter(app => enabled.has(app.id)).map(app => ({ ...app, enabled: enabled.get(app.id) })),
    orgApps,
    maxOrgApps: catalog.MAX_ORG_APPS,
  };
}

async function setCatalogAppEnabled(ctx, organizationId, appId, enabled) {
  authorizeOrg(ctx, organizationId, 'catalog.manage');
  if (typeof enabled !== 'boolean') throw new HttpError(400, 'Ungültige Anfrage.');
  const grant = await appAccess.setGrantEnabled(organizationId, appId, enabled);
  const app = (await store.listApps()).find(a => a.id === appId);
  await audit.record(ctx, { organizationId, action: enabled ? 'catalog.app_enabled' : 'catalog.app_disabled', targetType: 'app', targetId: appId, details: { name: app ? app.title : appId } });
  return grant;
}

async function createOrgApp(ctx, organizationId, input) {
  authorizeOrg(ctx, organizationId, 'catalog.manage');
  await organizations.getOrThrow(organizationId);
  const app = await catalog.createOrgApp(organizationId, input || {}, ctx.principal.email || ctx.principal.identityId);
  await audit.record(ctx, { organizationId, action: 'catalog.org_app_created', targetType: 'app', targetId: app.id, details: { name: app.title } });
  return app;
}

async function updateOrgApp(ctx, organizationId, appId, input) {
  authorizeOrg(ctx, organizationId, 'catalog.manage');
  const app = await catalog.updateOrgApp(organizationId, appId, input || {});
  await audit.record(ctx, { organizationId, action: 'catalog.org_app_updated', targetType: 'app', targetId: app.id, details: { name: app.title, enabled: app.enabled } });
  return app;
}

async function deleteOrgApp(ctx, organizationId, appId) {
  authorizeOrg(ctx, organizationId, 'catalog.manage');
  const app = await catalog.deleteOrgApp(organizationId, appId);
  await audit.record(ctx, { organizationId, action: 'catalog.org_app_deleted', targetType: 'app', targetId: app.id, details: { name: app.title } });
}

async function getOrganizationApps(ctx, organizationId) {
  requirePlatformAdmin(ctx);
  await organizations.getOrThrow(organizationId);
  return { appIds: await appAccess.listGrantedAppIds(organizationId) };
}

async function setOrganizationApps(ctx, organizationId, appIds) {
  requirePlatformAdmin(ctx);
  const organization = await organizations.getOrThrow(organizationId);
  const valid = await validAppIds(appIds);
  await applyAppGrants(ctx, organization, valid);
  return { appIds: await appAccess.listGrantedAppIds(organizationId) };
}

async function deleteApp(ctx, appId) {
  requirePlatformAdmin(ctx);
  await store.deleteApp(appId);
  const all = await organizations.list();
  await appAccess.removeAppEverywhere(appId, all.map(o => o.id));
  await audit.record(ctx, { action: 'app.deleted', targetType: 'app', targetId: appId });
}

function me(ctx) {
  if (!ctx.principal) return { authenticated: false };
  return {
    authenticated: true,
    email: ctx.principal.email,
    name: ctx.principal.name,
    isPlatformAdmin: ctx.isPlatformAdmin,
    membership: ctx.membership,
  };
}

module.exports = {
  me,
  getOrganization,
  renameOrganization,
  listUsers,
  updateUser,
  removeUser,
  listInvitations,
  invite,
  resendInvitation,
  revokeInvitation,
  previewInvitation,
  acceptInvitation,
  listOrganizations,
  createOrganization,
  setOrganizationStatus,
  deleteOrganization,
  listAudit,
  listPlatformAudit,
  listVisibleApps,
  myApps,
  saveMyAppSettings,
  createMyApp,
  updateMyApp,
  deleteMyApp,
  getCatalog,
  setCatalogAppEnabled,
  createOrgApp,
  updateOrgApp,
  deleteOrgApp,
  readAppHtml,
  getOrganizationApps,
  setOrganizationApps,
  deleteApp,
  isValidRole,
};
