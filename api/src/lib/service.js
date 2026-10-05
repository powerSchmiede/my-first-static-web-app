const { HttpError, AccessDenied } = require('./errors');
const { normalizeEmail } = require('./principal');
const { authorizeOrg, requirePlatformAdmin, assertCanAssignRole, requireAuthenticated, isValidRole } = require('./authz');
const organizations = require('./organizations');
const members = require('./members');
const audit = require('./audit');
const email = require('./email');

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
  const organization = await organizations.create(input.name, ctx.principal.email || ctx.principal.identityId);
  await audit.record(ctx, { organizationId: organization.id, action: 'organization.created', targetType: 'organization', targetId: organization.id, details: { name: organization.name } });
  await audit.record(ctx, { action: 'organization.created', targetType: 'organization', targetId: organization.id, details: { name: organization.name } });
  const { invitation, token } = await members.createInvitation(organization.id, { email: adminEmail, role: 'OrgAdmin', invitedBy: ctx.principal.email || ctx.principal.identityId });
  const result = await deliver(ctx, organization, invitation, token);
  await audit.record(ctx, { organizationId: organization.id, action: 'invitation.created', targetType: 'invitation', targetId: invitation.id, details: { email: adminEmail, role: 'OrgAdmin', emailSent: result.emailSent } });
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

async function listAudit(ctx, organizationId) {
  authorizeOrg(ctx, organizationId, 'audit.read');
  await organizations.getOrThrow(organizationId);
  return audit.list(organizationId);
}

async function listPlatformAudit(ctx) {
  requirePlatformAdmin(ctx);
  return audit.list(audit.PLATFORM_PARTITION);
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
  listAudit,
  listPlatformAudit,
  isValidRole,
};
