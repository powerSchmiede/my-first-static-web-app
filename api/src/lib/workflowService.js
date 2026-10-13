// Freigabe-Prozess für Systemrechte (zunächst DATEV) zwischen Kanzlei und Mandant:
//
//   1. Kanzlei-Mitarbeiter/in füllt Rechte für einen Benutzer vor  -> Antrag "pending"
//      To-do (+ E-Mail) an die zuständige Person/Gruppe des Mandanten
//   2. Mandant prüft, passt an, gibt frei oder lehnt ab           -> "approved" / "rejected"
//      To-do (+ E-Mail) an die Kanzlei
//   3. Kanzlei setzt in DATEV um und bestätigt                     -> "implemented"
//      KanzleiMind dokumentiert den freigegebenen Stand je Benutzer
//
// Alle Prüfungen laufen serverseitig; jeder Schritt landet im Protokoll des Mandanten.

const { HttpError, AccessDenied } = require('./errors');
const { authorizeOrg, requireAuthenticated, requirePlatformAdmin, isAssignedStaff } = require('./authz');
const organizations = require('./organizations');
const members = require('./members');
const groups = require('./groups');
const audit = require('./audit');
const email = require('./email');
const staff = require('./staff');
const workflow = require('./workflow');
const systemRights = require('./systemRights');

// ---------- Hilfen ----------

function activeMembership(ctx, organizationId) {
  const m = ctx.membership;
  return m && m.organizationId === organizationId && m.status === 'Active' && m.orgStatus === 'Active' ? m : null;
}

function isApprover(ctx, organizationId, approver) {
  const m = activeMembership(ctx, organizationId);
  if (!m) return false;
  if (approver.type === 'group') return m.groups.some(g => g.id === approver.groupId);
  return m.role === 'OrgAdmin';
}

function canSeeTodo(ctx, todo) {
  if (todo.assignee.type === 'kanzlei') return isAssignedStaff(ctx, todo.organizationId);
  const m = activeMembership(ctx, todo.organizationId);
  if (!m) return false;
  if (todo.assignee.type === 'user') return m.userId === todo.assignee.userId;
  if (todo.assignee.type === 'group') return m.groups.some(g => g.id === todo.assignee.groupId);
  return m.role === 'OrgAdmin';
}

// Zuständig ist die eingestellte Gruppe; existiert sie nicht mehr, die Org-Admins.
async function resolveApprover(organization) {
  const approver = organization.rightsApprover;
  if (approver.type === 'group') {
    const found = await groups.get(organization.id, approver.groupId).catch(() => null);
    if (found) return { type: 'group', groupId: approver.groupId, name: found.group.name };
  }
  return { type: 'admins', name: 'Organization Admins' };
}

async function recipients(organizationId, assignee) {
  if (assignee.type === 'kanzlei') return staff.staffForOrganization(organizationId);
  const users = (await members.listUsers(organizationId)).filter(u => u.status === 'Active');
  if (assignee.type === 'group') return users.filter(u => u.groups.includes(assignee.groupId)).map(u => u.email);
  if (assignee.type === 'user') return users.filter(u => u.id === assignee.userId).map(u => u.email);
  return users.filter(u => u.role === 'OrgAdmin').map(u => u.email);
}

async function notify(organizationId, todo, intro) {
  const path = todo.requestId ? `/antrag/${encodeURIComponent(organizationId)}/${encodeURIComponent(todo.requestId)}` : '/todos';
  const result = await email.sendNotification({
    to: await recipients(organizationId, todo.assignee),
    subject: `KanzleiMind: ${todo.title}`,
    intro,
    linkLabel: 'Zum To-do in KanzleiMind',
    path,
  });
  return { emailSent: result.sent, emailStatus: result.reason || 'sent', link: email.appLink(path) };
}

function nameOf(user) {
  return user.displayName && user.displayName !== user.email ? `${user.displayName} (${user.email})` : user.email;
}

function actor(ctx) {
  return ctx.staff ? ctx.staff.name || ctx.staff.email : ctx.principal.email || ctx.principal.identityId;
}

// Support durch den Plattform-Admin (ohne Zuordnung als Mitarbeiter) braucht eine Begründung.
function supportReason(ctx, organizationId, reason) {
  if (isAssignedStaff(ctx, organizationId) || activeMembership(ctx, organizationId) || !ctx.isPlatformAdmin) return '';
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < 3 || text.length > 300) {
    throw new HttpError(400, 'Bitte gib als KanzleiMind-Support eine Begründung an (z. B. Ticketnummer).', 'reason_required');
  }
  return text;
}

// ---------- Kanzlei: Mandanten ----------

async function listMandanten(ctx) {
  requireAuthenticated(ctx);
  if (!ctx.staff) throw new AccessDenied(403, 'Dieser Bereich ist Kanzlei-Mitarbeitenden vorbehalten.', { reason: 'not_staff' });
  const result = [];
  for (const organizationId of ctx.staff.organizationIds) {
    const organization = await organizations.get(organizationId);
    if (!organization) continue;
    const requests = await workflow.listRequests(organizationId);
    result.push({
      id: organization.id,
      name: organization.name,
      status: organization.status,
      pending: requests.filter(r => r.status === 'pending').length,
      toImplement: requests.filter(r => r.status === 'approved').length,
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// ---------- Rechte-Übersicht eines Mandanten ----------

async function getRightsOverview(ctx, organizationId) {
  authorizeOrg(ctx, organizationId, 'rights.read');
  const organization = await organizations.getOrThrow(organizationId);
  const [users, orgGroups, state, requests, approver] = await Promise.all([
    members.listUsers(organizationId),
    groups.list(organizationId),
    workflow.listSystemRights(organizationId),
    workflow.listRequests(organizationId),
    resolveApprover(organization),
  ]);
  return {
    organization: { id: organization.id, name: organization.name, status: organization.status },
    approver,
    groups: orgGroups.map(g => ({ id: g.id, name: g.name })),
    catalog: systemRights.catalog('datev'),
    users: users.map(u => ({
      id: u.id, email: u.email, displayName: u.displayName, role: u.role, status: u.status,
      groups: orgGroups.filter(g => u.groups.includes(g.id)).map(g => g.name),
      rights: (state[u.id] && state[u.id].rights.datev) || [],
      rightsUpdatedAt: state[u.id] ? state[u.id].updatedAt : '',
    })),
    requests,
    canRequest: isAssignedStaff(ctx, organizationId) || ctx.isPlatformAdmin,
    canConfigure: !!activeMembership(ctx, organizationId) && ctx.membership.role === 'OrgAdmin',
  };
}

// ---------- 1. Vorbefüllen ----------

async function createRequest(ctx, organizationId, input) {
  authorizeOrg(ctx, organizationId, 'rights.request');
  const reason = supportReason(ctx, organizationId, input && input.reason);
  const system = (input && input.system) || 'datev';
  const proposed = systemRights.validateRights(system, input && input.rights);
  const organization = await organizations.getOrThrow(organizationId);
  if (organization.status !== 'Active') throw new HttpError(409, 'Die Organisation ist deaktiviert.');
  const user = await members.getUser(organizationId, input && input.userId);
  if (!user) throw new HttpError(404, 'Nicht gefunden.');
  if (user.status !== 'Active') throw new HttpError(409, 'Der Benutzer ist deaktiviert.');
  const open = (await workflow.listRequests(organizationId)).find(r => r.targetUserId === user.id && r.system === system && ['pending', 'approved'].includes(r.status));
  if (open) throw new HttpError(409, 'Für diesen Benutzer gibt es bereits einen offenen Antrag.', 'request_open');

  const current = ((await workflow.getSystemRights(organizationId, user.id)).rights[system]) || [];
  const approver = await resolveApprover(organization);
  const comment = typeof input.comment === 'string' ? input.comment.trim().slice(0, 1000) : '';
  const request = await workflow.createRequest(organizationId, {
    system, targetUserId: user.id, targetEmail: user.email, targetName: user.displayName,
    current, proposed, comment, approver: { type: approver.type, groupId: approver.groupId }, createdBy: actor(ctx),
  });
  const todo = await workflow.createTodo(organizationId, {
    title: `DATEV-Rechte für ${nameOf(user)} prüfen und freigeben`,
    description: comment || `Die Kanzlei hat ${proposed.length} DATEV-Rechte vorbefüllt. Bitte prüfen, ggf. anpassen und freigeben.`,
    kind: 'approval', requestId: request.id, assignee: { type: approver.type, groupId: approver.groupId }, createdBy: actor(ctx),
  });
  const added = proposed.filter(k => !current.includes(k)).map(systemRights.title);
  const removed = current.filter(k => !proposed.includes(k)).map(systemRights.title);
  await audit.record(ctx, {
    organizationId, action: 'rights.requested', targetType: 'user', targetId: user.id,
    details: { email: user.email, system: 'DATEV', added, removed, approver: approver.name, ...(reason ? { reason } : {}) },
  });
  const notified = await notify(organizationId, todo, `Die Kanzlei hat DATEV-Rechte für ${nameOf(user)} in ${organization.name} vorbefüllt. Bitte prüfe und gib sie frei.`);
  return { request, todo, ...notified };
}

// ---------- Antrag ansehen ----------

function requestAccess(ctx, organizationId, request) {
  requireAuthenticated(ctx);
  const kanzlei = isAssignedStaff(ctx, organizationId);
  const member = activeMembership(ctx, organizationId);
  const approver = isApprover(ctx, organizationId, request.approver);
  if (kanzlei || ctx.isPlatformAdmin || approver || (member && member.role === 'OrgAdmin')) {
    return { kanzlei: kanzlei || (ctx.isPlatformAdmin && !member), approver };
  }
  throw new AccessDenied(member ? 403 : 404, member ? 'Dafür fehlt dir die Berechtigung.' : 'Nicht gefunden.', { reason: 'request_forbidden', requestId: request.id });
}

async function getRequest(ctx, organizationId, requestId) {
  requireAuthenticated(ctx);
  const request = await workflow.getRequest(organizationId, requestId);
  if (!request) {
    // Gleiche Antwort wie bei fehlender Berechtigung: keine Hinweise auf fremde Anträge.
    throw new AccessDenied(404, 'Nicht gefunden.', { reason: 'request_missing', requestId });
  }
  const access = requestAccess(ctx, organizationId, request);
  const organization = await organizations.getOrThrow(organizationId);
  const approver = await resolveApprover({ ...organization, rightsApprover: request.approver });
  return {
    request: { ...request, approverName: approver.name },
    organizationName: organization.name,
    catalog: systemRights.catalog(request.system),
    canDecide: access.approver && request.status === 'pending',
    canImplement: access.kanzlei && request.status === 'approved',
  };
}

// ---------- 2. Freigabe durch den Mandanten ----------

async function decide(ctx, organizationId, requestId, input) {
  requireAuthenticated(ctx);
  const request = await workflow.getRequest(organizationId, requestId);
  if (!request) throw new AccessDenied(404, 'Nicht gefunden.', { reason: 'request_missing', requestId });
  if (!isApprover(ctx, organizationId, request.approver)) {
    throw new AccessDenied(activeMembership(ctx, organizationId) ? 403 : 404, 'Nur die zuständige Person oder Gruppe kann diesen Antrag freigeben.', { reason: 'not_approver', requestId });
  }
  const decision = input && input.decision;
  if (!['approve', 'reject'].includes(decision)) throw new HttpError(400, 'Ungültige Entscheidung.');
  const comment = typeof input.comment === 'string' ? input.comment.trim().slice(0, 1000) : '';
  if (decision === 'reject' && !comment) throw new HttpError(400, 'Bitte gib bei einer Ablehnung einen Grund an.', 'comment_required');
  const approved = decision === 'approve' ? systemRights.validateRights(request.system, input.rights) : [];
  const now = new Date().toISOString();
  const updated = await workflow.transitionRequest(organizationId, requestId, 'pending', {
    status: decision === 'approve' ? 'approved' : 'rejected',
    approved,
    decidedBy: ctx.principal.email,
    decidedAt: now,
    decisionComment: comment,
  });
  await workflow.completeTodosForRequest(organizationId, requestId, 'approval', ctx.principal.email);

  const target = request.targetName && request.targetName !== request.targetEmail ? `${request.targetName} (${request.targetEmail})` : request.targetEmail;
  const todo = await workflow.createTodo(organizationId, decision === 'approve'
    ? { title: `DATEV-Rechte für ${target} umsetzen`, description: comment, kind: 'implementation', requestId, assignee: { type: 'kanzlei' }, createdBy: ctx.principal.email }
    : { title: `Antrag abgelehnt: DATEV-Rechte für ${target}`, description: comment, kind: 'info', requestId, assignee: { type: 'kanzlei' }, createdBy: ctx.principal.email });

  await audit.record(ctx, {
    organizationId, action: decision === 'approve' ? 'rights.approved' : 'rights.rejected', targetType: 'user', targetId: request.targetUserId,
    details: {
      email: request.targetEmail,
      system: 'DATEV',
      ...(decision === 'approve' ? {
        added: approved.filter(k => !request.proposed.includes(k)).map(systemRights.title),
        removed: request.proposed.filter(k => !approved.includes(k)).map(systemRights.title),
      } : {}),
      ...(comment ? { comment } : {}),
    },
  });
  const organization = await organizations.getOrThrow(organizationId);
  const notified = await notify(organizationId, todo, decision === 'approve'
    ? `${organization.name} hat die DATEV-Rechte für ${target} freigegeben. Bitte in DATEV umsetzen und in KanzleiMind bestätigen.`
    : `${organization.name} hat den Antrag für ${target} abgelehnt: ${comment}`);
  return { request: updated, ...notified };
}

// ---------- 3. Umsetzung durch die Kanzlei ----------

async function implement(ctx, organizationId, requestId, input) {
  authorizeOrg(ctx, organizationId, 'rights.request');
  const reason = supportReason(ctx, organizationId, input && input.reason);
  const request = await workflow.getRequest(organizationId, requestId);
  if (!request) throw new AccessDenied(404, 'Nicht gefunden.', { reason: 'request_missing', requestId });
  const updated = await workflow.transitionRequest(organizationId, requestId, 'approved', {
    status: 'implemented', implementedBy: actor(ctx), implementedAt: new Date().toISOString(),
  });
  await workflow.setSystemRights(organizationId, request.targetUserId, request.system, request.approved, requestId);
  await workflow.completeTodosForRequest(organizationId, requestId, 'implementation', actor(ctx));
  await audit.record(ctx, {
    organizationId, action: 'rights.implemented', targetType: 'user', targetId: request.targetUserId,
    details: { email: request.targetEmail, system: 'DATEV', count: request.approved.length, ...(reason ? { reason } : {}) },
  });
  return { request: updated };
}

// ---------- Zuständigkeit (Einstellungen des Mandanten) ----------

async function setApprover(ctx, organizationId, input) {
  authorizeOrg(ctx, organizationId, 'settings.approver');
  const reason = supportReason(ctx, organizationId, input && input.reason);
  let approver = { type: 'admins' };
  if (input && input.type === 'group') {
    const found = await groups.get(organizationId, input.groupId).catch(() => null);
    if (!found) throw new HttpError(400, 'Unbekannte Gruppe.');
    approver = { type: 'group', groupId: input.groupId };
  } else if (!input || input.type !== 'admins') {
    throw new HttpError(400, 'Ungültige Zuständigkeit.');
  }
  const updated = await organizations.update(organizationId, { rightsApprover: approver });
  const resolved = await resolveApprover(updated);
  await audit.record(ctx, { organizationId, action: 'settings.approver_changed', targetType: 'organization', targetId: organizationId, details: { name: resolved.name, ...(reason ? { reason } : {}) } });
  return resolved;
}

// ---------- To-dos ----------

async function listTodos(ctx) {
  requireAuthenticated(ctx);
  const orgIds = new Set([...(ctx.staff ? ctx.staff.organizationIds : []), ...(ctx.membership ? [ctx.membership.organizationId] : [])]);
  const result = [];
  for (const organizationId of orgIds) {
    const organization = await organizations.get(organizationId);
    if (!organization) continue;
    for (const todo of await workflow.listTodos(organizationId)) {
      if (canSeeTodo(ctx, todo)) result.push({ ...todo, organizationName: organization.name });
    }
  }
  return result.sort((a, b) => (a.status === b.status ? (a.createdAt < b.createdAt ? 1 : -1) : a.status === 'open' ? -1 : 1));
}

async function countOpenTodos(ctx) {
  try {
    return (await listTodos(ctx)).filter(t => t.status === 'open').length;
  } catch {
    return 0;
  }
}

// Informations-To-dos lassen sich abhaken; Freigabe und Umsetzung schließen sich über den Antrag.
async function completeTodo(ctx, organizationId, todoId) {
  requireAuthenticated(ctx);
  const todo = (await workflow.listTodos(organizationId)).find(t => t.id === todoId);
  if (!todo || !canSeeTodo(ctx, todo)) throw new AccessDenied(404, 'Nicht gefunden.', { reason: 'todo_forbidden', todoId });
  if (todo.kind === 'approval' || todo.kind === 'implementation') throw new HttpError(409, 'Dieses To-do wird über den Antrag erledigt.');
  if (todo.status !== 'open') return todo;
  const { table } = require('./tables');
  const client = await table('orgData');
  await client.updateEntity({ partitionKey: organizationId, rowKey: `todo_${todoId}`, status: 'done', completedAt: new Date().toISOString(), completedBy: ctx.principal.email }, 'Merge');
  return { ...todo, status: 'done' };
}

// ---------- Plattform: Kanzlei-Mitarbeitende ----------

async function listStaff(ctx) {
  requirePlatformAdmin(ctx);
  const [all, orgs] = await Promise.all([staff.list(), organizations.list()]);
  const names = new Map(orgs.map(o => [o.id, o.name]));
  return Promise.all(all.map(async s => ({
    ...s,
    organizations: (await staff.assignments(s.email)).map(a => ({ id: a.organizationId, name: names.get(a.organizationId) || '(gelöscht)', source: a.source })),
  })));
}

async function saveStaff(ctx, input) {
  requirePlatformAdmin(ctx);
  const saved = await staff.upsert(input || {}, ctx.principal.email);
  await audit.record(ctx, { action: 'staff.saved', targetType: 'staff', targetId: saved.email, details: { email: saved.email, name: saved.name, active: saved.active } });
  return saved;
}

async function removeStaff(ctx, emailAddress) {
  requirePlatformAdmin(ctx);
  if (!(await staff.get(emailAddress))) throw new HttpError(404, 'Nicht gefunden.');
  await staff.remove(emailAddress);
  await audit.record(ctx, { action: 'staff.removed', targetType: 'staff', targetId: emailAddress, details: { email: emailAddress } });
}

async function setStaffAssignments(ctx, emailAddress, organizationIds) {
  requirePlatformAdmin(ctx);
  if (!(await staff.get(emailAddress))) throw new HttpError(404, 'Nicht gefunden.');
  if (!Array.isArray(organizationIds) || organizationIds.some(id => typeof id !== 'string')) throw new HttpError(400, 'Ungültige Auswahl.');
  const known = new Set((await organizations.list()).map(o => o.id));
  if (organizationIds.some(id => !known.has(id))) throw new HttpError(400, 'Unbekannte Organisation.');
  const result = await staff.setAssignments(emailAddress, [...new Set(organizationIds)], ctx.principal.email);
  await audit.record(ctx, { action: 'staff.assignments_changed', targetType: 'staff', targetId: emailAddress, details: { email: emailAddress, count: result.length } });
  return result;
}

module.exports = {
  listMandanten, getRightsOverview, createRequest, getRequest, decide, implement, setApprover,
  listTodos, countOpenTodos, completeTodo, listStaff, saveStaff, removeStaff, setStaffAssignments,
};
