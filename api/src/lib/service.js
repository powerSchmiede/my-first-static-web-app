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
const permissions = require('./permissions');
const groups = require('./groups');
const profiles = require('./profiles');

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

function organizationStats(users, invitations) {
  return {
    users: users.length,
    activeUsers: users.filter(u => u.status === 'Active').length,
    disabledUsers: users.filter(u => u.status === 'Disabled').length,
    admins: users.filter(u => u.role === 'OrgAdmin').length,
    pendingInvitations: invitations.filter(i => i.status === 'Pending').length,
    expiredInvitations: invitations.filter(i => i.status === 'Expired').length,
  };
}

async function getOrganization(ctx, organizationId) {
  authorizeOrg(ctx, organizationId, 'org.read');
  const organization = await organizations.getOrThrow(organizationId);
  const [users, invitations] = await Promise.all([members.listUsers(organizationId), members.listInvitations(organizationId)]);
  return { ...organization, stats: organizationStats(users, invitations) };
}

// Alles für die Organisationsseite in einer Anfrage: eine Rechteprüfung, jede Tabelle einmal lesen.
async function getOrganizationOverview(ctx, organizationId) {
  for (const permission of ['org.read', 'users.read', 'invitations.manage', 'audit.read']) {
    authorizeOrg(ctx, organizationId, permission);
  }
  const [organization, users, invitations, auditEntries] = await Promise.all([
    organizations.getOrThrow(organizationId),
    members.listUsers(organizationId),
    members.listInvitations(organizationId),
    audit.list(organizationId),
  ]);
  return { organization: { ...organization, stats: organizationStats(users, invitations) }, users, invitations, audit: auditEntries };
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
  await profiles.remove(organizationId, userId);
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

// ---------- Rechte ----------

// Handelt ein Plattform-Admin in einer Organisation, der er nicht angehört, ist das Support.
function isSupport(ctx, organizationId) {
  return ctx.isPlatformAdmin && !(ctx.membership && ctx.membership.organizationId === organizationId);
}

function requireReason(ctx, organizationId, reason) {
  if (!isSupport(ctx, organizationId)) return '';
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < 3 || text.length > 300) {
    throw new HttpError(400, 'Bitte gib als KanzleiMind-Support eine Begründung an (z. B. Ticketnummer).', 'reason_required');
  }
  return text;
}

async function getPermissions(ctx, organizationId) {
  authorizeOrg(ctx, organizationId, 'permissions.manage');
  const [organization, users, orgGroups] = await Promise.all([organizations.getOrThrow(organizationId), members.listUsers(organizationId), groups.list(organizationId)]);
  return {
    catalog: permissions.CATALOG.map(p => ({ ...p, licensed: organization.modules.includes(p.module) })),
    modules: organization.modules,
    support: isSupport(ctx, organizationId),
    groups: orgGroups,
    users: users.map(u => ({
      id: u.id, email: u.email, displayName: u.displayName, role: u.role, status: u.status,
      permissions: u.permissions,
      groups: u.groups.filter(id => orgGroups.some(g => g.id === id)),
      inherited: groups.inheritedPermissions(u.groups, orgGroups),
    })),
  };
}

async function setUserPermissions(ctx, organizationId, userId, input) {
  authorizeOrg(ctx, organizationId, 'permissions.manage');
  const reason = requireReason(ctx, organizationId, input && input.reason);
  const wanted = permissions.validatePermissions(input && input.permissions);
  const [organization, user] = await Promise.all([organizations.getOrThrow(organizationId), members.getUser(organizationId, userId)]);
  if (!user) throw new HttpError(404, 'Nicht gefunden.');

  const before = new Set(user.permissions);
  const added = wanted.filter(p => !before.has(p));
  const removed = user.permissions.filter(p => !wanted.includes(p));
  // Neu vergeben werden kann nur, was für die Organisation freigeschaltet ist.
  if (added.some(p => !organization.modules.includes(permissions.moduleOf(p)))) {
    throw new HttpError(400, 'Dieser Bereich ist für eure Organisation nicht freigeschaltet.', 'not_licensed');
  }
  if (!added.length && !removed.length) return { id: user.id, permissions: user.permissions };

  const updated = await members.updateUser(organizationId, userId, { permissions: wanted });
  const label = key => (permissions.CATALOG.find(p => p.key === key) || { label: key }).label;
  await audit.record(ctx, {
    organizationId,
    action: 'user.permissions_changed',
    targetType: 'user',
    targetId: userId,
    details: { email: user.email, added: added.map(label), removed: removed.map(label), ...(reason ? { reason } : {}) },
  });
  return { id: updated.id, permissions: updated.permissions };
}

// ---------- Gruppen ----------

const permissionLabel = key => (permissions.CATALOG.find(p => p.key === key) || { label: key }).label;

function assertLicensed(organization, list) {
  if (list.some(p => !organization.modules.includes(permissions.moduleOf(p)))) {
    throw new HttpError(400, 'Dieser Bereich ist für eure Organisation nicht freigeschaltet.', 'not_licensed');
  }
}

async function listGroups(ctx, organizationId) {
  authorizeOrg(ctx, organizationId, 'groups.manage');
  const [orgGroups, users] = await Promise.all([groups.list(organizationId), members.listUsers(organizationId)]);
  return orgGroups.map(g => ({ ...g, members: users.filter(u => u.groups.includes(g.id)).map(u => u.id) }));
}

async function createGroup(ctx, organizationId, input) {
  authorizeOrg(ctx, organizationId, 'groups.manage');
  const reason = requireReason(ctx, organizationId, input && input.reason);
  const organization = await organizations.getOrThrow(organizationId);
  const wanted = input && input.permissions ? permissions.validatePermissions(input.permissions) : [];
  assertLicensed(organization, wanted);
  const group = await groups.create(organizationId, { name: input && input.name, permissions: wanted });
  await audit.record(ctx, { organizationId, action: 'group.created', targetType: 'group', targetId: group.id, details: { name: group.name, added: wanted.map(permissionLabel), ...(reason ? { reason } : {}) } });
  return { ...group, members: [] };
}

async function updateGroup(ctx, organizationId, groupId, input) {
  authorizeOrg(ctx, organizationId, 'groups.manage');
  const reason = requireReason(ctx, organizationId, input && input.reason);
  const organization = await organizations.getOrThrow(organizationId);
  const patchInput = {};
  if (input && input.name !== undefined) patchInput.name = input.name;
  if (input && input.permissions !== undefined) patchInput.permissions = permissions.validatePermissions(input.permissions);
  const existing = await groups.get(organizationId, groupId);
  if (!existing) throw new HttpError(404, 'Nicht gefunden.');
  if (patchInput.permissions) assertLicensed(organization, patchInput.permissions.filter(p => !existing.group.permissions.includes(p)));
  const { before, after } = await groups.update(organizationId, groupId, patchInput);
  const added = after.permissions.filter(p => !before.permissions.includes(p)).map(permissionLabel);
  const removed = before.permissions.filter(p => !after.permissions.includes(p)).map(permissionLabel);
  await audit.record(ctx, {
    organizationId, action: 'group.updated', targetType: 'group', targetId: groupId,
    details: { name: after.name, ...(before.name !== after.name ? { renamedFrom: before.name } : {}), added, removed, ...(reason ? { reason } : {}) },
  });
  return after;
}

async function deleteGroup(ctx, organizationId, groupId, input) {
  authorizeOrg(ctx, organizationId, 'groups.manage');
  const reason = requireReason(ctx, organizationId, input && input.reason);
  const group = await groups.remove(organizationId, groupId);
  // Zugehörigkeit bei allen Benutzern entfernen, damit keine Rechte aus einer gelöschten Gruppe bleiben.
  for (const user of await members.listUsers(organizationId)) {
    if (user.groups.includes(groupId)) await members.updateUser(organizationId, user.id, { groups: user.groups.filter(id => id !== groupId) });
  }
  await audit.record(ctx, { organizationId, action: 'group.deleted', targetType: 'group', targetId: groupId, details: { name: group.name, ...(reason ? { reason } : {}) } });
}

async function setUserGroups(ctx, organizationId, userId, input) {
  authorizeOrg(ctx, organizationId, 'groups.manage');
  const reason = requireReason(ctx, organizationId, input && input.reason);
  const wanted = input && Array.isArray(input.groupIds) && input.groupIds.every(id => typeof id === 'string') ? [...new Set(input.groupIds)] : null;
  if (!wanted || wanted.length > groups.MAX_GROUPS) throw new HttpError(400, 'Ungültige Gruppenauswahl.');
  const [user, orgGroups] = await Promise.all([members.getUser(organizationId, userId), groups.list(organizationId)]);
  if (!user) throw new HttpError(404, 'Nicht gefunden.');
  // Nur Gruppen der eigenen Organisation – fremde IDs werden abgelehnt.
  if (wanted.some(id => !orgGroups.some(g => g.id === id))) throw new HttpError(400, 'Unbekannte Gruppe.');
  const name = id => orgGroups.find(g => g.id === id).name;
  const current = user.groups.filter(id => orgGroups.some(g => g.id === id));
  const added = wanted.filter(id => !current.includes(id)).map(name);
  const removed = current.filter(id => !wanted.includes(id)).map(name);
  if (!added.length && !removed.length) return { id: user.id, groups: current };
  const updated = await members.updateUser(organizationId, userId, { groups: wanted });
  await audit.record(ctx, { organizationId, action: 'user.groups_changed', targetType: 'user', targetId: userId, details: { email: user.email, added, removed, ...(reason ? { reason } : {}) } });
  return { id: updated.id, groups: updated.groups };
}

// ---------- Profile ----------

// Kontaktdaten: der Benutzer selbst, Org-Admins und Benutzer mit Recht "Lohn" derselben Organisation.
// Lohndaten: nur der Benutzer selbst und Benutzer mit Recht "Lohn". KanzleiMind-Support nie.
function profileAccess(ctx, organizationId, userId) {
  requireAuthenticated(ctx);
  const m = activeMembership(ctx);
  if (!m || m.organizationId !== organizationId) {
    throw new AccessDenied(isSupport(ctx, organizationId) ? 403 : 404, isSupport(ctx, organizationId) ? 'Profildaten sind für den Support nicht einsehbar.' : 'Nicht gefunden.', { reason: 'profile_foreign', userId });
  }
  const self = m.userId === userId;
  const payrollRole = m.permissions.includes('module.lohn');
  const admin = m.role === 'OrgAdmin';
  if (!self && !payrollRole && !admin) throw new AccessDenied(403, 'Dafür fehlt dir die Berechtigung.', { reason: 'profile_forbidden', userId });
  return { self, contact: true, payroll: self || payrollRole };
}

async function buildProfile(ctx, organizationId, userId, access) {
  const user = await members.getUser(organizationId, userId);
  if (!user) throw new HttpError(404, 'Nicht gefunden.');
  const [orgGroups, organization, data] = await Promise.all([
    groups.list(organizationId),
    organizations.getOrThrow(organizationId),
    profiles.getProfile(organizationId, userId, { includePayroll: access.payroll }),
  ]);
  const inherited = groups.inheritedPermissions(user.groups, orgGroups);
  const effective = permissions.effectivePermissions([...new Set([...user.permissions, ...inherited])], organization.modules);
  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, status: user.status, organizationName: organization.name },
    groups: orgGroups.filter(g => user.groups.includes(g.id)).map(g => ({ id: g.id, name: g.name })),
    permissions: effective.map(key => ({
      key,
      label: permissionLabel(key),
      sources: [...(user.permissions.includes(key) ? ['direkt'] : []), ...orgGroups.filter(g => user.groups.includes(g.id) && g.permissions.includes(key)).map(g => `Gruppe ${g.name}`)],
    })),
    contact: data.contact,
    payroll: data.payroll,
    payrollConfigured: data.payrollConfigured,
    canViewPayroll: access.payroll,
    canEdit: { contact: access.self || ctx.membership.permissions.includes('module.lohn'), payroll: access.payroll },
    updatedAt: data.updatedAt,
  };
}

async function getMyProfile(ctx) {
  const m = requireMember(ctx);
  return buildProfile(ctx, m.organizationId, m.userId, profileAccess(ctx, m.organizationId, m.userId));
}

async function getUserProfile(ctx, organizationId, userId) {
  return buildProfile(ctx, organizationId, userId, profileAccess(ctx, organizationId, userId));
}

async function saveProfile(ctx, organizationId, userId, input) {
  const access = profileAccess(ctx, organizationId, userId);
  const canEditContact = access.self || ctx.membership.permissions.includes('module.lohn');
  if (!(await members.getUser(organizationId, userId))) throw new HttpError(404, 'Nicht gefunden.');
  const changed = [];
  if (input && input.contact) {
    if (!canEditContact) throw new AccessDenied(403, 'Kontaktdaten darf nur die Person selbst oder die Lohnbuchhaltung ändern.', { reason: 'profile_contact_forbidden', userId });
    changed.push(...(await profiles.saveContact(organizationId, userId, input.contact)));
    // Vor- und Nachname werden zum Anzeigenamen in Listen und Protokollen.
    const { contact } = await profiles.getProfile(organizationId, userId, { includePayroll: false });
    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
    if (fullName) await members.updateUser(organizationId, userId, { displayName: fullName });
  }
  if (input && input.payroll) {
    if (!access.payroll) throw new AccessDenied(403, 'Lohndaten darf nur die Person selbst oder die Lohnbuchhaltung ändern.', { reason: 'profile_payroll_forbidden', userId });
    changed.push(...(await profiles.savePayroll(organizationId, userId, input.payroll)));
  }
  // Protokolliert wird nur, welche Felder sich geändert haben – nie die Werte.
  if (changed.length) {
    await audit.record(ctx, { organizationId, action: 'profile.updated', targetType: 'user', targetId: userId, details: { fields: changed, ...(access.self ? {} : { by: 'Lohnbuchhaltung/Admin' }) } });
  }
  return buildProfile(ctx, organizationId, userId, access);
}

async function saveMyProfile(ctx, input) {
  const m = requireMember(ctx);
  return saveProfile(ctx, m.organizationId, m.userId, input);
}

async function getOrganizationModules(ctx, organizationId) {
  requirePlatformAdmin(ctx);
  const organization = await organizations.getOrThrow(organizationId);
  return { modules: organization.modules, available: permissions.MODULES };
}

async function setOrganizationModules(ctx, organizationId, modules) {
  requirePlatformAdmin(ctx);
  const before = await organizations.getOrThrow(organizationId);
  const updated = await organizations.update(organizationId, { modules });
  const title = key => (permissions.MODULES.find(m => m.key === key) || { title: key }).title;
  const added = updated.modules.filter(m => !before.modules.includes(m)).map(title);
  const removed = before.modules.filter(m => !updated.modules.includes(m)).map(title);
  if (added.length || removed.length) {
    const details = { name: updated.name, added, removed };
    await audit.record(ctx, { organizationId, action: 'organization.modules_changed', targetType: 'organization', targetId: organizationId, details });
    await audit.record(ctx, { action: 'organization.modules_changed', targetType: 'organization', targetId: organizationId, details });
  }
  return { modules: updated.modules, available: permissions.MODULES };
}

// Prüfung für Bereiche: nur wirksame Rechte des Benutzers in seiner eigenen Organisation.
// Plattform-Admins erhalten bewusst keinen automatischen Zugriff auf Bereichsdaten.
function checkModuleAccess(ctx, moduleKey) {
  requireAuthenticated(ctx);
  if (!permissions.MODULE_KEYS.includes(moduleKey)) throw new HttpError(404, 'Nicht gefunden.');
  const membership = ctx.membership;
  const permission = `module.${moduleKey}`;
  if (!membership || !membership.permissions.includes(permission)) {
    throw new AccessDenied(403, 'Für diesen Bereich hast du keine Berechtigung. Wende dich an den Administrator deiner Organisation.', { reason: 'missing_module_permission', permission });
  }
  return { module: moduleKey, access: true };
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
  getOrganizationOverview,
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
  getPermissions,
  setUserPermissions,
  getOrganizationModules,
  setOrganizationModules,
  checkModuleAccess,
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  setUserGroups,
  getMyProfile,
  getUserProfile,
  saveMyProfile,
  saveProfile,
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
