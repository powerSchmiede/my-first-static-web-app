// Sicherheitstests für Mandantentrennung und Autorisierung.
// Voraussetzung: lokaler Azurite-Speicher (UseDevelopmentStorage=true).
// Aufruf: npm test (im Ordner api)

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.STORAGE_CONNECTION_STRING = process.env.STORAGE_CONNECTION_STRING || 'UseDevelopmentStorage=true';
const run = crypto.randomUUID().slice(0, 8);
const PLATFORM_EMAIL = `owner-${run}@platform.test`;
process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_EMAIL;
delete process.env.ACS_CONNECTION_STRING;
process.env.PROFILE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const functions = require('@azure/functions');
const routes = [];
functions.app.http = (name, options) => routes.push({ name, ...options });
require('../src/functions/organizations');
require('../src/functions/apps');
require('../src/functions/workflow');

function principal(name, email, provider = 'kanzleimind') {
  return { identityProvider: provider, userId: `${name}-${run}`, userDetails: email, userRoles: ['anonymous', 'authenticated'], claims: [{ typ: 'email', val: email }, { typ: 'name', val: name }] };
}

const owner = principal('owner', PLATFORM_EMAIL);
const alice = principal('alice', `alice-${run}@a.test`);
const bob = principal('bob', `bob-${run}@b.test`);
const carol = principal('carol', `carol-${run}@a.test`);
const mallory = principal('mallory', `mallory-${run}@evil.test`);

function match(template, path) {
  const t = template.split('/');
  const p = path.split('/');
  if (t.length !== p.length) return null;
  const params = {};
  for (let i = 0; i < t.length; i++) {
    const m = /^\{(\w+)\}$/.exec(t[i]);
    if (m) params[m[1]] = p[i];
    else if (t[i] !== p[i]) return null;
  }
  return params;
}

async function call(method, path, { as, body } = {}) {
  for (const route of routes) {
    const params = match(route.route, path);
    if (!params || !route.methods.includes(method)) continue;
    const headers = {};
    if (as) headers['x-ms-client-principal'] = Buffer.from(JSON.stringify(as)).toString('base64');
    if (body) headers['content-type'] = 'application/json';
    const request = new functions.HttpRequest({
      method,
      url: `http://localhost/api/${path}`,
      headers,
      params,
      body: body ? { string: JSON.stringify(body) } : undefined,
    });
    const result = await route.handler(request, { error: () => {}, log: () => {} });
    return { status: result.status || 200, body: result.jsonBody, headers: result.headers || {} };
  }
  throw new Error(`Keine Route für ${method} ${path}`);
}

const tokenOf = response => decodeURIComponent(response.body.inviteLink.split('#token=')[1]);

const state = {};

before(async () => {
  const orgA = await call('POST', 'platform/orgs', { as: owner, body: { name: `Org A ${run}`, adminEmail: alice.claims[0].val } });
  assert.equal(orgA.status, 201);
  state.orgA = orgA.body.organization.id;
  assert.equal((await call('POST', 'invitations/accept', { as: alice, body: { token: tokenOf(orgA) } })).status, 200);

  const orgB = await call('POST', 'platform/orgs', { as: owner, body: { name: `Org B ${run}`, adminEmail: bob.claims[0].val } });
  state.orgB = orgB.body.organization.id;
  state.orgBToken = tokenOf(orgB);
  assert.equal((await call('POST', 'invitations/accept', { as: bob, body: { token: state.orgBToken } })).status, 200);

  const invite = await call('POST', `orgs/${state.orgA}/invitations`, { as: alice, body: { email: carol.claims[0].val, role: 'OrgUser' } });
  assert.equal(invite.status, 201);
  state.carolToken = tokenOf(invite);

  const bobUsers = await call('GET', `orgs/${state.orgB}/users`, { as: bob });
  state.bobId = bobUsers.body[0].id;
});

test('Einladung nur mit passender E-Mail-Adresse annehmbar', async () => {
  const response = await call('POST', 'invitations/accept', { as: mallory, body: { token: state.carolToken } });
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'email_mismatch');
});

test('Einladung ist nur einmal verwendbar', async () => {
  assert.equal((await call('POST', 'invitations/accept', { as: carol, body: { token: state.carolToken } })).status, 200);
  const again = await call('POST', 'invitations/accept', { as: carol, body: { token: state.carolToken } });
  assert.equal(again.status, 404);
});

test('Erster Benutzer wird Organization Admin, eingeladener Benutzer bekommt die eingeladene Rolle', async () => {
  const meAlice = await call('GET', 'me', { as: alice });
  assert.equal(meAlice.body.membership.role, 'OrgAdmin');
  assert.equal(meAlice.body.membership.organizationId, state.orgA);
  const meCarol = await call('GET', 'me', { as: carol });
  assert.equal(meCarol.body.membership.role, 'OrgUser');
});

test('Ohne Anmeldung kein Zugriff', async () => {
  assert.equal((await call('GET', `orgs/${state.orgA}/users`)).status, 401);
  assert.equal((await call('GET', 'platform/orgs')).status, 401);
});

test('Nicht zugelassener Anmeldeanbieter gilt als nicht angemeldet', async () => {
  const fake = principal('alice', alice.claims[0].val, 'github');
  assert.equal((await call('GET', `orgs/${state.orgA}/users`, { as: fake })).status, 401);
});

test('IDOR: Org Admin sieht keine fremde Organisation', async () => {
  assert.equal((await call('GET', `orgs/${state.orgB}`, { as: alice })).status, 404);
  assert.equal((await call('GET', `orgs/${state.orgB}/users`, { as: alice })).status, 404);
  assert.equal((await call('GET', `orgs/${state.orgB}/invitations`, { as: alice })).status, 404);
  assert.equal((await call('GET', `orgs/${state.orgB}/audit`, { as: alice })).status, 404);
});

test('IDOR: Org Admin kann fremde Benutzer nicht ändern, auch nicht über die eigene Organisations-URL', async () => {
  assert.equal((await call('PATCH', `orgs/${state.orgB}/users/${state.bobId}`, { as: alice, body: { status: 'Disabled' } })).status, 404);
  assert.equal((await call('DELETE', `orgs/${state.orgB}/users/${state.bobId}`, { as: alice })).status, 404);
  assert.equal((await call('PATCH', `orgs/${state.orgA}/users/${state.bobId}`, { as: alice, body: { status: 'Disabled' } })).status, 404);
  const bobUsers = await call('GET', `orgs/${state.orgB}/users`, { as: bob });
  assert.equal(bobUsers.body[0].status, 'Active');
});

test('IDOR: Einladungen fremder Organisationen nicht erzeugbar', async () => {
  assert.equal((await call('POST', `orgs/${state.orgB}/invitations`, { as: alice, body: { email: `x-${run}@b.test`, role: 'OrgAdmin' } })).status, 404);
});

test('Organization User hat keinen Zugriff auf die Benutzerverwaltung', async () => {
  assert.equal((await call('GET', `orgs/${state.orgA}/users`, { as: carol })).status, 403);
  assert.equal((await call('POST', `orgs/${state.orgA}/invitations`, { as: carol, body: { email: `y-${run}@a.test` } })).status, 403);
});

test('Keine Plattformrechte für Org Admins', async () => {
  assert.equal((await call('GET', 'platform/orgs', { as: alice })).status, 403);
  assert.equal((await call('POST', 'platform/orgs', { as: alice, body: { name: 'Hack', adminEmail: 'h@h.test' } })).status, 403);
  assert.equal((await call('POST', 'manage/apps', { as: alice, body: { title: 'x', type: 'none', icon: 'chat', background: 'rings' } })).status, 403);
});

test('Unbekannte Rollen werden abgelehnt', async () => {
  assert.equal((await call('POST', `orgs/${state.orgA}/invitations`, { as: alice, body: { email: `z-${run}@a.test`, role: 'PlatformAdmin' } })).status, 400);
});

test('Keine Änderungen an der eigenen Rolle oder dem eigenen Status', async () => {
  const users = await call('GET', `orgs/${state.orgA}/users`, { as: alice });
  const self = users.body.find(u => u.email === alice.claims[0].val);
  assert.equal((await call('PATCH', `orgs/${state.orgA}/users/${self.id}`, { as: alice, body: { role: 'OrgUser' } })).status, 403);
  assert.equal((await call('DELETE', `orgs/${state.orgA}/users/${self.id}`, { as: alice })).status, 403);
});

test('Der letzte aktive Org Admin bleibt erhalten', async () => {
  const users = await call('GET', `orgs/${state.orgA}/users`, { as: owner });
  const self = users.body.find(u => u.email === alice.claims[0].val);
  assert.equal((await call('PATCH', `orgs/${state.orgA}/users/${self.id}`, { as: owner, body: { status: 'Disabled' } })).status, 409);
});

test('Deaktivierte Benutzer verlieren sofort ihre Rechte', async () => {
  const users = await call('GET', `orgs/${state.orgA}/users`, { as: alice });
  const carolId = users.body.find(u => u.email === carol.claims[0].val).id;
  assert.equal((await call('PATCH', `orgs/${state.orgA}/users/${carolId}`, { as: alice, body: { role: 'OrgAdmin' } })).status, 200);
  assert.equal((await call('GET', `orgs/${state.orgA}/users`, { as: carol })).status, 200);
  assert.equal((await call('PATCH', `orgs/${state.orgA}/users/${carolId}`, { as: alice, body: { status: 'Disabled' } })).status, 200);
  assert.equal((await call('GET', `orgs/${state.orgA}/users`, { as: carol })).status, 403);
});

test('Eine Identität gehört genau einer Organisation an', async () => {
  const invite = await call('POST', `orgs/${state.orgB}/invitations`, { as: bob, body: { email: alice.claims[0].val, role: 'OrgUser' } });
  const response = await call('POST', 'invitations/accept', { as: alice, body: { token: tokenOf(invite) } });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'already_member');
});

test('Zurückgezogene Einladungen sind ungültig', async () => {
  const invite = await call('POST', `orgs/${state.orgA}/invitations`, { as: alice, body: { email: `dave-${run}@a.test` } });
  assert.equal((await call('DELETE', `orgs/${state.orgA}/invitations/${invite.body.invitation.id}`, { as: alice })).status, 200);
  const dave = principal('dave', `dave-${run}@a.test`);
  assert.equal((await call('POST', 'invitations/accept', { as: dave, body: { token: tokenOf(invite) } })).status, 404);
});

test('Erneut gesendete Einladungen entwerten den alten Link', async () => {
  const invite = await call('POST', `orgs/${state.orgA}/invitations`, { as: alice, body: { email: `erin-${run}@a.test` } });
  const resent = await call('POST', `orgs/${state.orgA}/invitations/${invite.body.invitation.id}/resend`, { as: alice });
  assert.equal(resent.status, 200);
  const erin = principal('erin', `erin-${run}@a.test`);
  assert.equal((await call('POST', 'invitations/accept', { as: erin, body: { token: tokenOf(invite) } })).status, 404);
  assert.equal((await call('POST', 'invitations/accept', { as: erin, body: { token: tokenOf(resent) } })).status, 200);
});

test('Deaktivierte Organisation sperrt ihre Admins', async () => {
  assert.equal((await call('PATCH', `platform/orgs/${state.orgB}`, { as: owner, body: { status: 'Disabled' } })).status, 200);
  assert.equal((await call('GET', `orgs/${state.orgB}/users`, { as: bob })).status, 403);
  assert.equal((await call('PATCH', `platform/orgs/${state.orgB}`, { as: owner, body: { status: 'Active' } })).status, 200);
});

test('Audit-Log enthält Aktionen und verweigerte Zugriffe der eigenen Organisation', async () => {
  const log = await call('GET', `orgs/${state.orgA}/audit`, { as: alice });
  assert.equal(log.status, 200);
  const actions = log.body.map(entry => entry.action);
  for (const action of ['organization.created', 'invitation.created', 'invitation.accepted', 'user.role_changed', 'user.disabled', 'invitation.revoked', 'invitation.resent', 'access.denied']) {
    assert.ok(actions.includes(action), `Audit fehlt: ${action}`);
  }
  const denied = log.body.find(entry => entry.action === 'access.denied');
  assert.equal(denied.result, 'denied');
});


// ---------- App-Freigaben ----------

const HTML_APP = 'ki-bild-check';
const appIds = response => response.body.map(app => app.id);

test('Ohne Login gibt es keine Apps und keine App-Inhalte', async () => {
  assert.equal((await call('GET', 'apps')).status, 401);
  assert.equal((await call('GET', `apps/${HTML_APP}/html`)).status, 401);
});

test('Ohne Freigabe sieht eine Organisation keine Apps', async () => {
  const response = await call('GET', 'apps', { as: bob });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, []);
  assert.equal((await call('GET', `apps/${HTML_APP}/html`, { as: bob })).status, 404);
});

test('Benutzer ohne Organisation sehen keine Apps', async () => {
  const response = await call('GET', 'apps', { as: mallory });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, []);
  assert.equal((await call('GET', `apps/${HTML_APP}/html`, { as: mallory })).status, 404);
});

test('Freigaben gelten nur für die eigene Organisation', async () => {
  const set = await call('PUT', `platform/orgs/${state.orgA}/apps`, { as: owner, body: { appIds: [HTML_APP] } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.appIds, [HTML_APP]);

  // Freigeschaltet heißt noch nicht sichtbar: Erst der Org-Admin gibt die App für Benutzer frei.
  const erin = principal('erin', `erin-${run}@a.test`);
  assert.deepEqual((await call('GET', 'apps', { as: alice })).body, []);
  assert.equal((await call('GET', `apps/${HTML_APP}/html`, { as: erin })).status, 404);
  // Der Org-Admin darf die freigeschaltete App vorab testen.
  assert.equal((await call('GET', `apps/${HTML_APP}/html`, { as: alice })).status, 200);

  assert.equal((await call('PATCH', `orgs/${state.orgA}/catalog/${HTML_APP}`, { as: alice, body: { enabled: true } })).status, 200);
  assert.deepEqual(appIds(await call('GET', 'apps', { as: alice })), [HTML_APP]);
  assert.deepEqual(appIds(await call('GET', 'apps', { as: erin })), [HTML_APP]);
  assert.equal((await call('GET', `apps/${HTML_APP}/html`, { as: erin })).status, 200);

  // Org B bleibt ohne Zugriff, auch bei direktem Aufruf der Adresse.
  assert.deepEqual((await call('GET', 'apps', { as: bob })).body, []);
  assert.equal((await call('GET', `apps/${HTML_APP}/html`, { as: bob })).status, 404);
});

test('Nur Plattform-Admins vergeben App-Freigaben', async () => {
  assert.equal((await call('PUT', `platform/orgs/${state.orgA}/apps`, { as: alice, body: { appIds: [] } })).status, 403);
  assert.equal((await call('PUT', `platform/orgs/${state.orgB}/apps`, { as: bob, body: { appIds: [HTML_APP] } })).status, 403);
  assert.equal((await call('GET', `platform/orgs/${state.orgA}/apps`, { as: alice })).status, 403);
  assert.deepEqual((await call('GET', 'apps', { as: bob })).body, []);
});

test('Unbekannte App-IDs werden abgelehnt', async () => {
  assert.equal((await call('PUT', `platform/orgs/${state.orgA}/apps`, { as: owner, body: { appIds: ['gibt-es-nicht'] } })).status, 400);
  assert.equal((await call('PUT', `platform/orgs/${state.orgA}/apps`, { as: owner, body: { appIds: 'ki-bild-check' } })).status, 400);
  assert.deepEqual((await call('GET', `platform/orgs/${state.orgA}/apps`, { as: owner })).body.appIds, [HTML_APP]);
});

test('Deaktivierte Organisation verliert den Zugriff auf Apps', async () => {
  await call('PATCH', `platform/orgs/${state.orgA}`, { as: owner, body: { status: 'Disabled' } });
  assert.deepEqual((await call('GET', 'apps', { as: alice })).body, []);
  assert.equal((await call('GET', `apps/${HTML_APP}/html`, { as: alice })).status, 403);
  await call('PATCH', `platform/orgs/${state.orgA}`, { as: owner, body: { status: 'Active' } });
  assert.equal((await call('GET', `apps/${HTML_APP}/html`, { as: alice })).status, 200);
});

test('Neue Organisation erhält ausgewählte Apps, neue Apps sind nirgends freigegeben', async () => {
  const created = await call('POST', 'platform/orgs', { as: owner, body: { name: `Org C ${run}`, adminEmail: `dave-${run}@c.test`, appIds: [HTML_APP] } });
  assert.equal(created.status, 201);
  assert.deepEqual((await call('GET', `platform/orgs/${created.body.organization.id}/apps`, { as: owner })).body.appIds, [HTML_APP]);

  const app = await call('POST', 'manage/apps', { as: owner, body: { title: `Test ${run}`, type: 'none', icon: 'sparkle', background: 'rings' } });
  assert.equal(app.status, 201);
  assert.ok(!appIds(await call('GET', 'apps', { as: alice })).includes(app.body.id));
  assert.ok(appIds(await call('GET', 'apps', { as: owner })).includes(app.body.id));
});

test('Gelöschte Apps verlieren alle Freigaben', async () => {
  const app = await call('POST', 'manage/apps', { as: owner, body: { title: `Weg ${run}`, type: 'none', icon: 'sparkle', background: 'rings' } });
  await call('PUT', `platform/orgs/${state.orgA}/apps`, { as: owner, body: { appIds: [HTML_APP, app.body.id] } });
  assert.equal((await call('DELETE', `manage/apps/${app.body.id}`, { as: owner })).status, 204);
  assert.deepEqual((await call('GET', `platform/orgs/${state.orgA}/apps`, { as: owner })).body.appIds, [HTML_APP]);
});


// ---------- Anmeldewege ----------

test('Registrieren und Anmelden führen zum selben KanzleiMind-Konto', async () => {
  const email = `frank-${run}@a.test`;
  const invite = await call('POST', `orgs/${state.orgA}/invitations`, { as: alice, body: { email, role: 'OrgUser' } });
  const viaSignup = principal('frank', email, 'kanzleimindsignup');
  assert.equal((await call('POST', 'invitations/accept', { as: viaSignup, body: { token: tokenOf(invite) } })).status, 200);

  const viaSignin = { ...principal('frank', email, 'kanzleimind'), userId: 'anderer-swa-user' };
  const me = await call('GET', 'me', { as: viaSignin });
  assert.equal(me.body.membership.organizationId, state.orgA);
});

test('Microsoft-365-Konto ist eine eigene Identität mit dem Anmeldenamen als E-Mail', async () => {
  const email = `gina-${run}@a.test`;
  const invite = await call('POST', `orgs/${state.orgA}/invitations`, { as: alice, body: { email, role: 'OrgUser' } });
  const m365 = principal('gina', email, 'aad');
  assert.equal((await call('POST', 'invitations/accept', { as: m365, body: { token: tokenOf(invite) } })).status, 200);
  assert.equal((await call('GET', 'me', { as: m365 })).body.membership.organizationId, state.orgA);

  // Gleiche Adresse über ein KanzleiMind-Konto ist nicht automatisch dasselbe Konto.
  assert.equal((await call('GET', 'me', { as: principal('gina', email) })).body.membership, null);
});

test('Gastkonten, unbekannte Anbieter und Konten ohne E-Mail gelten als nicht angemeldet', async () => {
  const guest = principal('guest', `alice-${run}_a.test#EXT#@evil.onmicrosoft.com`, 'aad');
  assert.equal((await call('GET', `orgs/${state.orgA}/users`, { as: guest })).status, 401);
  assert.equal((await call('GET', 'apps', { as: principal('x', alice.userDetails, 'twitter') })).status, 401);
  assert.equal((await call('GET', 'apps', { as: principal('x', 'kein-name') })).status, 401);
});

test('Alte KanzleiMind-Konten werden auf den neuen Schlüssel umgestellt', async () => {
  const { table } = require('../src/lib/tables');
  const { migrateLegacyIdentities } = require('../src/lib/context');
  const email = `legacy-${run}@a.test`;
  const adminEmail = `legacy-admin-${run}@platform.test`;
  const userId = `legacy-${run}`;
  const orgData = await table('orgData');
  await orgData.createEntity({ partitionKey: state.orgA, rowKey: `user_${userId}`, identityId: `aad|old-${run}`, email, displayName: 'Legacy', role: 'OrgUser', status: 'Active', createdAt: new Date().toISOString() });
  await (await table('identities')).createEntity({ partitionKey: `aad|old-${run}`, rowKey: 'membership', organizationId: state.orgA, userId });
  await (await table('platformAdmins')).createEntity({ partitionKey: `aad|old-admin-${run}`, rowKey: 'platform', email: adminEmail, createdAt: new Date().toISOString() });

  await migrateLegacyIdentities();

  const me = await call('GET', 'me', { as: principal('legacy', email) });
  assert.equal(me.body.membership.userId, userId);
  assert.equal((await call('GET', 'me', { as: principal('legacy-admin', adminEmail) })).body.isPlatformAdmin, true);
  // Der alte Schlüssel gilt jetzt als Microsoft-365-Identität und hat keinen Zugriff mehr.
  assert.equal((await call('GET', 'me', { as: { ...principal('legacy', email, 'aad'), userId: `old-${run}` } })).body.membership, null);
});


// ---------- Organisation löschen ----------

test('Organisation löschen: nur Plattform-Admin, nur deaktiviert, nur mit Namensbestätigung, entfernt alles', async () => {
  const name = `Org Weg ${run}`;
  const henry = principal('henry', `henry-${run}@weg.test`);
  const created = await call('POST', 'platform/orgs', { as: owner, body: { name, adminEmail: henry.userDetails, appIds: ['ki-bild-check'] } });
  const orgId = created.body.organization.id;
  assert.equal((await call('POST', 'invitations/accept', { as: henry, body: { token: tokenOf(created) } })).status, 200);
  const pending = await call('POST', `orgs/${orgId}/invitations`, { as: henry, body: { email: `ida-${run}@weg.test`, role: 'OrgUser' } });
  assert.equal(pending.status, 201);

  // Org-Admins dürfen ihre eigene Organisation nicht löschen.
  assert.equal((await call('POST', `platform/orgs/${orgId}/delete`, { as: henry, body: { confirmName: name } })).status, 403);
  // Aktive Organisationen werden nicht gelöscht.
  assert.equal((await call('POST', `platform/orgs/${orgId}/delete`, { as: owner, body: { confirmName: name } })).status, 409);

  await call('PATCH', `platform/orgs/${orgId}`, { as: owner, body: { status: 'Disabled' } });
  assert.equal((await call('POST', `platform/orgs/${orgId}/delete`, { as: owner, body: { confirmName: 'falsch' } })).status, 400);
  assert.equal((await call('POST', `platform/orgs/${orgId}/delete`, { as: owner, body: { confirmName: name } })).status, 204);

  // Organisation, Freigaben, Mitgliedschaft und Einladungslinks sind weg.
  assert.equal((await call('GET', `platform/orgs/${orgId}/apps`, { as: owner })).status, 404);
  assert.ok(!(await call('GET', 'platform/orgs', { as: owner })).body.some(o => o.id === orgId));
  assert.equal((await call('GET', 'me', { as: henry })).body.membership, null);
  assert.deepEqual((await call('GET', 'apps', { as: henry })).body, []);
  assert.equal((await call('POST', 'invitations/preview', { body: { token: tokenOf(pending) } })).status, 404);
  assert.equal((await call('GET', `orgs/${orgId}/audit`, { as: owner })).status, 404);

  // Die Person kann neu in eine andere Organisation eingeladen werden.
  const again = await call('POST', `orgs/${state.orgA}/invitations`, { as: alice, body: { email: henry.userDetails, role: 'OrgUser' } });
  assert.equal((await call('POST', 'invitations/accept', { as: henry, body: { token: tokenOf(again) } })).status, 200);

  const log = await call('GET', 'platform/audit', { as: owner });
  assert.ok(log.body.some(entry => entry.action === 'organization.deleted' && entry.targetId === orgId));
});


// ---------- App-Katalog, Apps der Organisation, eigene Apps ----------

const LINK = { title: 'Wiki', type: 'link', url: 'https://example.com/wiki', icon: 'book', background: 'grid' };
const keys = response => response.body.map(app => app.key);

test('App-Katalog: nur der Org-Admin der eigenen Organisation', async () => {
  const erin = principal('erin', `erin-${run}@a.test`);
  const own = await call('GET', `orgs/${state.orgA}/catalog`, { as: alice });
  assert.equal(own.status, 200);
  assert.ok(own.body.platformApps.some(app => app.id === HTML_APP && app.enabled === true));

  assert.equal((await call('GET', `orgs/${state.orgA}/catalog`, { as: bob })).status, 404);
  assert.equal((await call('GET', `orgs/${state.orgA}/catalog`, { as: erin })).status, 403);
  assert.equal((await call('PATCH', `orgs/${state.orgA}/catalog/${HTML_APP}`, { as: bob, body: { enabled: false } })).status, 404);
  // Nicht freigeschaltete Apps kann der Org-Admin nicht selbst sichtbar schalten.
  assert.equal((await call('PATCH', `orgs/${state.orgB}/catalog/${HTML_APP}`, { as: bob, body: { enabled: true } })).status, 404);
  assert.deepEqual((await call('GET', 'apps', { as: bob })).body, []);
});

test('Apps der Organisation: nur https-Links, nur eigene Organisation, Sichtbarkeit wirkt', async () => {
  const erin = principal('erin', `erin-${run}@a.test`);
  for (const url of ['javascript:alert(1)', 'http://example.com', '/api/orgs', 'data:text/html,x', '']) {
    assert.equal((await call('POST', `orgs/${state.orgA}/apps`, { as: alice, body: { ...LINK, url } })).status, 400, url);
  }
  assert.equal((await call('POST', `orgs/${state.orgA}/apps`, { as: erin, body: LINK })).status, 403);
  assert.equal((await call('POST', `orgs/${state.orgA}/apps`, { as: bob, body: LINK })).status, 404);

  const created = await call('POST', `orgs/${state.orgA}/apps`, { as: alice, body: LINK });
  assert.equal(created.status, 201);
  const key = `o-${created.body.id}`;
  assert.ok(keys(await call('GET', 'apps', { as: erin })).includes(key));
  assert.ok(!keys(await call('GET', 'apps', { as: bob })).includes(key));

  // Fremde Org-Admins erreichen die App weder über ihre noch über die fremde Organisation.
  assert.equal((await call('PATCH', `orgs/${state.orgB}/apps/${created.body.id}`, { as: bob, body: { enabled: false } })).status, 404);
  assert.equal((await call('DELETE', `orgs/${state.orgA}/apps/${created.body.id}`, { as: bob })).status, 404);

  assert.equal((await call('PATCH', `orgs/${state.orgA}/apps/${created.body.id}`, { as: alice, body: { enabled: false } })).status, 200);
  assert.ok(!keys(await call('GET', 'apps', { as: erin })).includes(key));
  assert.equal((await call('PATCH', `orgs/${state.orgA}/apps/${created.body.id}`, { as: alice, body: { url: 'javascript:x' } })).status, 400);
  assert.equal((await call('DELETE', `orgs/${state.orgA}/apps/${created.body.id}`, { as: alice })).status, 204);
  assert.equal((await call('GET', `orgs/${state.orgA}/catalog`, { as: alice })).body.orgApps.length, 0);
});

test('Eigene Apps sieht nur der Benutzer selbst', async () => {
  const erin = principal('erin', `erin-${run}@a.test`);
  assert.equal((await call('POST', 'me/apps', { as: erin, body: { ...LINK, url: 'javascript:alert(1)' } })).status, 400);
  const mine = await call('POST', 'me/apps', { as: erin, body: { ...LINK, title: 'Meine Notizen' } });
  assert.equal(mine.status, 201);
  const key = `u-${mine.body.id}`;
  assert.ok(keys(await call('GET', 'apps', { as: erin })).includes(key));
  assert.ok(!keys(await call('GET', 'apps', { as: alice })).includes(key));

  // Andere Benutzer können fremde eigene Apps weder ändern noch löschen.
  assert.equal((await call('PUT', `me/apps/${mine.body.id}`, { as: alice, body: LINK })).status, 404);
  assert.equal((await call('DELETE', `me/apps/${mine.body.id}`, { as: bob })).status, 404);
  assert.equal((await call('PUT', `me/apps/${mine.body.id}`, { as: erin, body: { ...LINK, title: 'Notizen' } })).body.title, 'Notizen');

  // Ohne Organisation keine eigenen Apps (auch nicht als Plattform-Admin).
  assert.equal((await call('GET', 'me/apps', { as: owner })).status, 403);
  assert.equal((await call('POST', 'me/apps', { as: mallory, body: LINK })).status, 403);
  assert.equal((await call('DELETE', `me/apps/${mine.body.id}`, { as: erin })).status, 204);
});

test('Persönliche Reihenfolge und ausgeblendete Apps', async () => {
  const erin = principal('erin', `erin-${run}@a.test`);
  const first = await call('POST', 'me/apps', { as: erin, body: { ...LINK, title: 'A' } });
  const second = await call('POST', 'me/apps', { as: erin, body: { ...LINK, title: 'B' } });
  const a = `u-${first.body.id}`;
  const b = `u-${second.body.id}`;

  assert.equal((await call('PUT', 'me/app-settings', { as: erin, body: { order: [b, a], hidden: [`p-${HTML_APP}`] } })).status, 200);
  const visible = keys(await call('GET', 'apps', { as: erin }));
  assert.ok(!visible.includes(`p-${HTML_APP}`));
  assert.ok(visible.indexOf(b) < visible.indexOf(a));
  // Ausgeblendet heißt nicht gesperrt: In den Einstellungen bleibt die App sichtbar.
  const all = await call('GET', 'me/apps', { as: erin });
  assert.equal(all.body.apps.find(app => app.key === `p-${HTML_APP}`).hidden, true);
  // Einstellungen wirken nur für den Benutzer selbst.
  assert.ok(keys(await call('GET', 'apps', { as: alice })).includes(`p-${HTML_APP}`));

  assert.equal((await call('PUT', 'me/app-settings', { as: erin, body: { order: 'x', hidden: [] } })).status, 400);
  assert.equal((await call('PUT', 'me/app-settings', { as: erin, body: { order: [], hidden: [] } })).status, 200);
});

test('Höchstzahl eigener Apps', async () => {
  const kim = principal('kim', `kim-${run}@a.test`);
  const invite = await call('POST', `orgs/${state.orgA}/invitations`, { as: alice, body: { email: kim.userDetails, role: 'OrgUser' } });
  assert.equal((await call('POST', 'invitations/accept', { as: kim, body: { token: tokenOf(invite) } })).status, 200);
  for (let i = 0; i < 30; i++) {
    assert.equal((await call('POST', 'me/apps', { as: kim, body: { ...LINK, title: `App ${i}` } })).status, 201);
  }
  assert.equal((await call('POST', 'me/apps', { as: kim, body: LINK })).status, 409);

  // Beim Entfernen des Benutzers verschwinden auch seine eigenen Apps und Einstellungen.
  await call('PUT', 'me/app-settings', { as: kim, body: { order: [], hidden: ['p-x'] } });
  const kimId = (await call('GET', 'me', { as: kim })).body.membership.userId;
  assert.equal((await call('DELETE', `orgs/${state.orgA}/users/${kimId}`, { as: alice })).status, 204);
  const { table } = require('../src/lib/tables');
  const orgData = await table('orgData');
  const leftovers = [];
  for await (const entity of orgData.listEntities({ queryOptions: { filter: `PartitionKey eq '${state.orgA}'` } })) {
    if (entity.rowKey.includes(kimId)) leftovers.push(entity.rowKey);
  }
  assert.deepEqual(leftovers, []);
});


test('Eigene HTML-Apps laufen abgeschottet und lassen sich nur in KanzleiMind einbetten', async () => {
  const response = await call('GET', `apps/${HTML_APP}/html`, { as: alice });
  assert.equal(response.status, 200);
  const csp = response.headers['Content-Security-Policy'];
  assert.match(csp, /(^|;\s*)sandbox /);
  assert.ok(!/allow-same-origin/.test(csp), 'App darf nicht den Ursprung von KanzleiMind erhalten');
  assert.ok(!/allow-top-navigation/.test(csp), 'App darf die Seite nicht umleiten');
  assert.match(csp, /frame-ancestors 'self'/);
  assert.equal(response.headers['X-Frame-Options'], 'SAMEORIGIN');
});

test('Organisationsübersicht in einer Anfrage: nur Org-Admin der eigenen Organisation', async () => {
  const erin = principal('erin', `erin-${run}@a.test`);
  const own = await call('GET', `orgs/${state.orgA}/overview`, { as: alice });
  assert.equal(own.status, 200);
  assert.equal(own.body.organization.id, state.orgA);
  assert.ok(own.body.users.some(u => u.email === alice.userDetails));
  assert.ok(Array.isArray(own.body.invitations) && Array.isArray(own.body.audit));
  assert.equal(own.body.organization.stats.users, own.body.users.length);

  assert.equal((await call('GET', `orgs/${state.orgA}/overview`, { as: bob })).status, 404);
  assert.equal((await call('GET', `orgs/${state.orgA}/overview`, { as: erin })).status, 403);
  assert.equal((await call('GET', `orgs/${state.orgA}/overview`)).status, 401);
});

// ---------- Rechteverwaltung ----------

async function userIdOf(as) {
  return (await call('GET', 'me', { as })).body.membership.userId;
}

test('Bereiche: erst Freischaltung durch die Plattform, dann Vergabe durch den Org-Admin', async () => {
  const erin = principal('erin', `erin-${run}@a.test`);
  const aliceId = await userIdOf(alice);
  const erinId = await userIdOf(erin);

  // Ohne Freischaltung kann der Org-Admin den Bereich nicht vergeben.
  const blocked = await call('PUT', `orgs/${state.orgA}/users/${erinId}/permissions`, { as: alice, body: { permissions: ['module.lohn'] } });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.code, 'not_licensed');

  // Nur der Plattform-Admin schaltet Bereiche frei.
  assert.equal((await call('PUT', `platform/orgs/${state.orgA}/modules`, { as: alice, body: { modules: ['lohn'] } })).status, 403);
  assert.equal((await call('PUT', `platform/orgs/${state.orgA}/modules`, { as: owner, body: { modules: ['lohn', 'unbekannt'] } })).status, 400);
  assert.deepEqual((await call('PUT', `platform/orgs/${state.orgA}/modules`, { as: owner, body: { modules: ['lohn', 'fibu'] } })).body.modules, ['fibu', 'lohn']);

  // Auch der Org-Admin selbst hat den Bereich erst, wenn er ihn sich vergibt.
  assert.equal((await call('GET', 'modules/lohn', { as: alice })).status, 403);
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${aliceId}/permissions`, { as: alice, body: { permissions: ['module.lohn'] } })).status, 200);
  assert.equal((await call('GET', 'modules/lohn', { as: alice })).status, 200);
  assert.ok((await call('GET', 'me', { as: alice })).body.membership.permissions.includes('module.lohn'));

  // Benutzer ohne Recht: kein Zugriff; nach Vergabe: Zugriff, aber nur auf den vergebenen Bereich.
  assert.equal((await call('GET', 'modules/lohn', { as: erin })).status, 403);
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${erinId}/permissions`, { as: alice, body: { permissions: ['module.fibu'] } })).status, 200);
  assert.equal((await call('GET', 'modules/fibu', { as: erin })).status, 200);
  assert.equal((await call('GET', 'modules/lohn', { as: erin })).status, 403);
  assert.equal((await call('GET', 'modules/gibt-es-nicht', { as: erin })).status, 404);
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${erinId}/permissions`, { as: alice, body: { permissions: ['admin.alles'] } })).status, 400);
});

test('Rechte: nur Org-Admin der eigenen Organisation, keine Selbstbedienung für Benutzer', async () => {
  const erin = principal('erin', `erin-${run}@a.test`);
  const erinId = await userIdOf(erin);
  const bobId = state.bobId;

  assert.equal((await call('GET', `orgs/${state.orgA}/permissions`, { as: erin })).status, 403);
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${erinId}/permissions`, { as: erin, body: { permissions: ['module.lohn'] } })).status, 403);
  // Fremde Organisation: weder lesen noch ändern, auch nicht über die eigene Organisations-URL.
  assert.equal((await call('GET', `orgs/${state.orgA}/permissions`, { as: bob })).status, 404);
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${erinId}/permissions`, { as: bob, body: { permissions: [] } })).status, 404);
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${bobId}/permissions`, { as: alice, body: { permissions: ['module.fibu'] } })).status, 404);
  // Org B hat keine Freischaltung, Bob bekommt Bereiche aus Org A nicht.
  assert.equal((await call('GET', 'modules/fibu', { as: bob })).status, 403);
});

test('Wird die Freischaltung entzogen, wirken vergebene Rechte nicht mehr', async () => {
  const erin = principal('erin', `erin-${run}@a.test`);
  await call('PUT', `platform/orgs/${state.orgA}/modules`, { as: owner, body: { modules: ['lohn'] } });
  assert.equal((await call('GET', 'modules/fibu', { as: erin })).status, 403);
  assert.ok(!(await call('GET', 'me', { as: erin })).body.membership.permissions.includes('module.fibu'));
  // Erneute Freischaltung stellt das gespeicherte Recht wieder her.
  await call('PUT', `platform/orgs/${state.orgA}/modules`, { as: owner, body: { modules: ['lohn', 'fibu'] } });
  assert.equal((await call('GET', 'modules/fibu', { as: erin })).status, 200);
});

test('Support: Plattform-Admin ändert Rechte nur mit Begründung, sichtbar im Protokoll der Organisation', async () => {
  const erin = principal('erin', `erin-${run}@a.test`);
  const erinId = await userIdOf(erin);
  const overview = await call('GET', `orgs/${state.orgA}/permissions`, { as: owner });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.support, true);

  const withoutReason = await call('PUT', `orgs/${state.orgA}/users/${erinId}/permissions`, { as: owner, body: { permissions: ['module.fibu', 'module.lohn'] } });
  assert.equal(withoutReason.status, 400);
  assert.equal(withoutReason.body.code, 'reason_required');
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${erinId}/permissions`, { as: owner, body: { permissions: ['module.fibu', 'module.lohn'], reason: 'Ticket #4711' } })).status, 200);

  const log = await call('GET', `orgs/${state.orgA}/audit`, { as: alice });
  const entry = log.body.find(e => e.action === 'user.permissions_changed' && e.actorKind === 'support');
  assert.ok(entry, 'Support-Änderung fehlt im Protokoll der Organisation');
  assert.equal(entry.details.reason, 'Ticket #4711');
  assert.deepEqual(entry.details.added, ['Lohn']);

  // Plattform-Admins haben ohne eigene Mitgliedschaft keinen Zugriff auf Bereichsdaten.
  assert.equal((await call('GET', 'modules/lohn', { as: owner })).status, 403);
});

test('Deaktivierte Benutzer verlieren den Zugriff auf Bereiche', async () => {
  const erin = principal('erin', `erin-${run}@a.test`);
  const erinId = await userIdOf(erin);
  await call('PATCH', `orgs/${state.orgA}/users/${erinId}`, { as: alice, body: { status: 'Disabled' } });
  assert.equal((await call('GET', 'modules/fibu', { as: erin })).status, 403);
  await call('PATCH', `orgs/${state.orgA}/users/${erinId}`, { as: alice, body: { status: 'Active' } });
  assert.equal((await call('GET', 'modules/fibu', { as: erin })).status, 200);
});


// ---------- Gruppen ----------

async function joinOrgA(name) {
  const person = principal(name, `${name}-${run}@a.test`);
  const invite = await call('POST', `orgs/${state.orgA}/invitations`, { as: alice, body: { email: person.userDetails, role: 'OrgUser' } });
  assert.equal((await call('POST', 'invitations/accept', { as: person, body: { token: tokenOf(invite) } })).status, 200);
  return { person, id: await userIdOf(person) };
}

test('Gruppen vererben Rechte an ihre Mitglieder', async () => {
  const erin = principal('erin', `erin-${run}@a.test`);
  const { person: hans, id: hansId } = await joinOrgA('hans');

  assert.equal((await call('POST', `orgs/${state.orgA}/groups`, { as: erin, body: { name: 'Lohn' } })).status, 403);
  assert.equal((await call('POST', `orgs/${state.orgA}/groups`, { as: bob, body: { name: 'Lohn' } })).status, 404);
  // Nicht freigeschaltete Bereiche können auch Gruppen nicht tragen.
  assert.equal((await call('POST', `orgs/${state.orgA}/groups`, { as: alice, body: { name: 'Doku', permissions: ['module.dokumente'] } })).body.code, 'not_licensed');

  const group = await call('POST', `orgs/${state.orgA}/groups`, { as: alice, body: { name: 'Lohn', permissions: ['module.lohn'] } });
  assert.equal(group.status, 201);
  assert.equal((await call('POST', `orgs/${state.orgA}/groups`, { as: alice, body: { name: 'lohn' } })).status, 409);

  assert.equal((await call('GET', 'modules/lohn', { as: hans })).status, 403);
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${hansId}/groups`, { as: alice, body: { groupIds: [group.body.id] } })).status, 200);
  assert.equal((await call('GET', 'modules/lohn', { as: hans })).status, 200);
  assert.deepEqual((await call('GET', 'me', { as: hans })).body.membership.groups.map(g => g.name), ['Lohn']);

  // Recht aus der Gruppe entfernen wirkt sofort für alle Mitglieder.
  assert.equal((await call('PATCH', `orgs/${state.orgA}/groups/${group.body.id}`, { as: alice, body: { permissions: [] } })).status, 200);
  assert.equal((await call('GET', 'modules/lohn', { as: hans })).status, 403);
  await call('PATCH', `orgs/${state.orgA}/groups/${group.body.id}`, { as: alice, body: { permissions: ['module.lohn'] } });

  // Gelöschte Gruppen hinterlassen keine Rechte.
  assert.equal((await call('POST', `orgs/${state.orgA}/groups/${group.body.id}/delete`, { as: alice, body: {} })).status, 204);
  assert.equal((await call('GET', 'modules/lohn', { as: hans })).status, 403);
  assert.deepEqual((await call('GET', 'me', { as: hans })).body.membership.groups, []);
  state.hans = { person: hans, id: hansId };
});

test('Gruppen fremder Organisationen lassen sich nicht zuweisen', async () => {
  const foreign = await call('POST', `orgs/${state.orgB}/groups`, { as: bob, body: { name: 'IT' } });
  assert.equal(foreign.status, 201);
  // Org-A-Admin kann keine Org-B-Gruppe vergeben, Bob keine Gruppe an Org-A-Benutzer.
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${state.hans.id}/groups`, { as: alice, body: { groupIds: [foreign.body.id] } })).status, 400);
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${state.hans.id}/groups`, { as: bob, body: { groupIds: [] } })).status, 404);
  assert.equal((await call('PATCH', `orgs/${state.orgA}/groups/${foreign.body.id}`, { as: alice, body: { name: 'gekapert' } })).status, 404);
  assert.equal((await call('PATCH', `orgs/${state.orgB}/groups/${foreign.body.id}`, { as: alice, body: { name: 'gekapert' } })).status, 404);
});

test('Support ändert Gruppen nur mit Begründung', async () => {
  assert.equal((await call('POST', `orgs/${state.orgA}/groups`, { as: owner, body: { name: 'HR' } })).body.code, 'reason_required');
  const created = await call('POST', `orgs/${state.orgA}/groups`, { as: owner, body: { name: 'HR', reason: 'Ticket #7' } });
  assert.equal(created.status, 201);
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${state.hans.id}/groups`, { as: owner, body: { groupIds: [created.body.id] } })).body.code, 'reason_required');
});

// ---------- Profile ----------

const PAYROLL = { taxId: '12345678901', taxClass: '1', iban: 'DE89 3704 0044 0532 0130 00', socialSecurityNumber: '12 345678 A 123', birthDate: '1990-05-17', zip: '80331', weeklyHours: '38.5' };

test('Profil: eigene Daten pflegen, Lohndaten werden verschlüsselt gespeichert', async () => {
  const { person: hans, id: hansId } = state.hans;
  const empty = await call('GET', 'me/profile', { as: hans });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.canViewPayroll, true);
  assert.equal(empty.body.payroll.taxId, '');

  assert.equal((await call('PUT', 'me/profile', { as: hans, body: { payroll: { iban: 'DE00 1234 5678 9012 3456 78' } } })).status, 400);
  assert.equal((await call('PUT', 'me/profile', { as: hans, body: { payroll: { taxId: '123' } } })).status, 400);
  assert.equal((await call('PUT', 'me/profile', { as: hans, body: { payroll: { birthDate: '2999-01-01' } } })).status, 400);

  const saved = await call('PUT', 'me/profile', { as: hans, body: { contact: { firstName: 'Hans', lastName: 'Muster', phone: '+49 89 123456' }, payroll: PAYROLL } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.payroll.iban, 'DE89370400440532013000');
  assert.equal(saved.body.payroll.socialSecurityNumber, '12345678A123');
  assert.equal(saved.body.user.displayName, 'Hans Muster');

  // In der Datenbank steht kein Klartext.
  const { table } = require('../src/lib/tables');
  const raw = await (await table('orgData')).getEntity(state.orgA, `prof_${hansId}`);
  assert.match(raw.payroll, /^v1:/);
  assert.ok(!JSON.stringify(raw).includes('12345678901') && !JSON.stringify(raw).includes('DE89370400440532013000'));

  // Protokoll nennt Felder, nie Werte.
  const log = await call('GET', `orgs/${state.orgA}/audit`, { as: alice });
  const entry = log.body.find(e => e.action === 'profile.updated' && e.targetId === hansId);
  assert.ok(entry.details.fields.includes('IBAN'));
  assert.ok(!JSON.stringify(log.body).includes('DE89370400440532013000'));
});

test('Profil: Lohndaten nur für die Person und Benutzer mit Recht Lohn, nie für Support oder fremde Orgs', async () => {
  const { id: hansId } = state.hans;
  const aliceId = await userIdOf(alice);

  // Kollegin ohne Recht: kein Zugriff.
  const { person: ida } = await joinOrgA('ida');
  assert.equal((await call('GET', `orgs/${state.orgA}/users/${hansId}/profile`, { as: ida })).status, 403);
  // Org-Admin ohne Recht Lohn: Kontaktdaten ja, Lohndaten nein.
  await call('PUT', `orgs/${state.orgA}/users/${aliceId}/permissions`, { as: alice, body: { permissions: [] } });
  const asAdmin = await call('GET', `orgs/${state.orgA}/users/${hansId}/profile`, { as: alice });
  assert.equal(asAdmin.status, 200);
  assert.equal(asAdmin.body.contact.firstName, 'Hans');
  assert.equal(asAdmin.body.payroll, null);
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${hansId}/profile`, { as: alice, body: { payroll: { taxClass: '3' } } })).status, 403);
  // Mit Recht Lohn: Lohndaten sichtbar und änderbar.
  await call('PUT', `orgs/${state.orgA}/users/${aliceId}/permissions`, { as: alice, body: { permissions: ['module.lohn'] } });
  const asPayroll = await call('GET', `orgs/${state.orgA}/users/${hansId}/profile`, { as: alice });
  assert.equal(asPayroll.body.payroll.taxId, '12345678901');
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${hansId}/profile`, { as: alice, body: { payroll: { taxClass: '3' } } })).status, 200);

  // Support und fremde Organisationen: kein Zugriff.
  assert.equal((await call('GET', `orgs/${state.orgA}/users/${hansId}/profile`, { as: owner })).status, 403);
  assert.equal((await call('GET', `orgs/${state.orgA}/users/${hansId}/profile`, { as: bob })).status, 404);
  assert.equal((await call('GET', `orgs/${state.orgB}/users/${hansId}/profile`, { as: bob })).status, 404);
});

test('Profil: ohne Schlüssel keine Lohndaten, beim Entfernen des Benutzers wird das Profil gelöscht', async () => {
  const { person: hans, id: hansId } = state.hans;
  const savedKey = process.env.PROFILE_ENCRYPTION_KEY;
  delete process.env.PROFILE_ENCRYPTION_KEY;
  const res = await call('PUT', 'me/profile', { as: hans, body: { payroll: { taxClass: '1' } } });
  assert.equal(res.status, 503);
  assert.equal((await call('GET', 'me/profile', { as: hans })).body.payroll, null);
  process.env.PROFILE_ENCRYPTION_KEY = savedKey;

  assert.equal((await call('DELETE', `orgs/${state.orgA}/users/${hansId}`, { as: alice })).status, 204);
  const { table } = require('../src/lib/tables');
  await assert.rejects((await table('orgData')).getEntity(state.orgA, `prof_${hansId}`));
});


// ---------- Kanzlei-Mitarbeitende und Freigabe-Prozess (DATEV-Rechte) ----------

const ma1 = principal('ma1', `ma1-${run}@kanzlei.test`, 'aad');
const ma2 = principal('ma2', `ma2-${run}@kanzlei.test`, 'aad');
const RIGHTS = ['datev.bank.kontoumsaetze', 'datev.belege_personal.lohn_unterlagen', 'datev.personalwirtschaft.personaldaten'];
const todosOf = async as => (await call('GET', 'todos', { as })).body;

test('Kanzlei-Mitarbeitende: nur der Plattform-Admin legt sie an und ordnet Mandanten zu', async () => {
  assert.equal((await call('POST', 'platform/staff', { as: alice, body: { email: ma1.userDetails } })).status, 403);
  assert.equal((await call('POST', 'platform/staff', { as: owner, body: { email: ma1.userDetails, name: 'Mia Kanzlei' } })).status, 200);
  assert.equal((await call('POST', 'platform/staff', { as: owner, body: { email: ma2.userDetails, name: 'Max Kanzlei' } })).status, 200);
  assert.equal((await call('PUT', `platform/staff/${encodeURIComponent(ma1.userDetails)}/orgs`, { as: owner, body: { organizationIds: [state.orgA] } })).status, 200);
  assert.equal((await call('PUT', `platform/staff/${encodeURIComponent(ma1.userDetails)}/orgs`, { as: owner, body: { organizationIds: ['gibt-es-nicht'] } })).status, 400);

  const me = await call('GET', 'me', { as: ma1 });
  assert.deepEqual(me.body.staff.organizations.map(o => o.id), [state.orgA]);
  assert.deepEqual((await call('GET', 'kanzlei/mandanten', { as: ma1 })).body.map(o => o.id), [state.orgA]);
  assert.deepEqual((await call('GET', 'kanzlei/mandanten', { as: ma2 })).body, []);
  assert.equal((await call('GET', 'kanzlei/mandanten', { as: alice })).status, 403);
  // Mitarbeitende nur mit Microsoft-365-Anmeldung: dieselbe Adresse als KanzleiMind-Konto zählt nicht.
  assert.equal((await call('GET', 'kanzlei/mandanten', { as: principal('ma1', ma1.userDetails) })).status, 403);
});

test('Kanzlei-Mitarbeitende sehen nur zugeordnete Mandanten und keine Lohndaten', async () => {
  assert.equal((await call('GET', `orgs/${state.orgA}/rights`, { as: ma1 })).status, 200);
  assert.equal((await call('GET', `orgs/${state.orgB}/rights`, { as: ma1 })).status, 404);
  assert.equal((await call('GET', `orgs/${state.orgA}/rights`, { as: ma2 })).status, 404);
  const erinId = await userIdOf(principal('erin', `erin-${run}@a.test`));
  // Keine Verwaltung und keine Profile/Lohndaten.
  assert.equal((await call('PUT', `orgs/${state.orgA}/users/${erinId}/permissions`, { as: ma1, body: { permissions: [] } })).status, 404);
  assert.equal((await call('GET', `orgs/${state.orgA}/users/${erinId}/profile`, { as: ma1 })).status, 404);
  assert.equal((await call('GET', `orgs/${state.orgA}/audit`, { as: ma1 })).status, 404);
});

test('Freigabe-Prozess: Kanzlei füllt vor, Org-Admins geben frei, Kanzlei setzt um', async () => {
  const erin = principal('erin', `erin-${run}@a.test`);
  const erinId = await userIdOf(erin);

  // Vorbefüllen dürfen nur zugeordnete Kanzlei-Mitarbeitende (Org-Admins und Benutzer nicht).
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests`, { as: alice, body: { userId: erinId, rights: RIGHTS } })).status, 403);
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests`, { as: ma2, body: { userId: erinId, rights: RIGHTS } })).status, 404);
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests`, { as: ma1, body: { userId: erinId, rights: ['datev.alles'] } })).status, 400);
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests`, { as: ma1, body: { userId: state.bobId, rights: RIGHTS } })).status, 404);

  const created = await call('POST', `orgs/${state.orgA}/rights-requests`, { as: ma1, body: { userId: erinId, rights: RIGHTS, comment: 'Neue Lohnsachbearbeiterin' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.emailStatus, 'not_configured');
  const requestId = created.body.request.id;
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests`, { as: ma1, body: { userId: erinId, rights: RIGHTS } })).body.code, 'request_open');

  // To-do landet bei den Org-Admins (Standard), nicht bei Benutzern und nicht bei fremden Orgs.
  assert.ok((await todosOf(alice)).some(t => t.requestId === requestId && t.kind === 'approval' && t.status === 'open'));
  assert.ok(!(await todosOf(erin)).some(t => t.requestId === requestId));
  assert.ok(!(await todosOf(bob)).some(t => t.requestId === requestId));
  assert.ok((await call('GET', 'me', { as: alice })).body.openTodos >= 1);

  // Antrag ansehen: Admin ja, Benutzerin ohne Zuständigkeit nein, fremde Org nein.
  assert.equal((await call('GET', `orgs/${state.orgA}/rights-requests/${requestId}`, { as: alice })).body.canDecide, true);
  assert.equal((await call('GET', `orgs/${state.orgA}/rights-requests/${requestId}`, { as: erin })).status, 403);
  assert.equal((await call('GET', `orgs/${state.orgA}/rights-requests/${requestId}`, { as: bob })).status, 404);

  // Entscheiden: nur Zuständige – nicht die Kanzlei, nicht der Support.
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests/${requestId}/decision`, { as: ma1, body: { decision: 'approve', rights: RIGHTS } })).status, 404);
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests/${requestId}/decision`, { as: owner, body: { decision: 'approve', rights: RIGHTS } })).status, 404);
  // Umsetzen geht erst nach Freigabe.
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests/${requestId}/implemented`, { as: ma1, body: {} })).body.code, 'request_state');

  const adjusted = RIGHTS.slice(0, 2);
  const decided = await call('POST', `orgs/${state.orgA}/rights-requests/${requestId}/decision`, { as: alice, body: { decision: 'approve', rights: adjusted, comment: 'Personaldaten nicht nötig' } });
  assert.equal(decided.status, 200);
  assert.deepEqual([...decided.body.request.approved].sort(), [...adjusted].sort());
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests/${requestId}/decision`, { as: alice, body: { decision: 'approve', rights: RIGHTS } })).body.code, 'request_state');
  assert.ok(!(await todosOf(alice)).some(t => t.requestId === requestId && t.status === 'open'));
  assert.ok((await todosOf(ma1)).some(t => t.requestId === requestId && t.kind === 'implementation' && t.status === 'open'));
  assert.ok(!(await todosOf(ma2)).some(t => t.requestId === requestId));

  // Umsetzen: nur Kanzlei; Org-Admin nicht.
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests/${requestId}/implemented`, { as: alice, body: {} })).status, 403);
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests/${requestId}/implemented`, { as: ma1, body: {} })).status, 200);
  const overview = await call('GET', `orgs/${state.orgA}/rights`, { as: alice });
  assert.deepEqual([...overview.body.users.find(u => u.id === erinId).rights].sort(), [...adjusted].sort());
  assert.ok(!(await todosOf(ma1)).some(t => t.requestId === requestId && t.status === 'open'));

  // Protokoll des Mandanten: Kanzlei-Schritte sind gekennzeichnet.
  const log = (await call('GET', `orgs/${state.orgA}/audit`, { as: alice })).body;
  for (const action of ['rights.requested', 'rights.approved', 'rights.implemented']) assert.ok(log.some(e => e.action === action), action);
  assert.equal(log.find(e => e.action === 'rights.requested').actorKind, 'kanzlei');
  assert.deepEqual(log.find(e => e.action === 'rights.approved').details.removed, ['Personalwirtschaft › Personaldaten']);
});

test('Zuständige Gruppe: nur deren Mitglieder geben frei, Ablehnung braucht einen Grund', async () => {
  const { person: lena, id: lenaId } = await joinOrgA('lena');
  const group = await call('POST', `orgs/${state.orgA}/groups`, { as: alice, body: { name: `Lohn-Freigabe ${run}` } });
  await call('PUT', `orgs/${state.orgA}/users/${lenaId}/groups`, { as: alice, body: { groupIds: [group.body.id] } });
  assert.equal((await call('PUT', `orgs/${state.orgA}/settings/rights-approver`, { as: ma1, body: { type: 'group', groupId: group.body.id } })).status, 404);
  assert.equal((await call('PUT', `orgs/${state.orgA}/settings/rights-approver`, { as: alice, body: { type: 'group', groupId: 'fremd' } })).status, 400);
  assert.equal((await call('PUT', `orgs/${state.orgA}/settings/rights-approver`, { as: alice, body: { type: 'group', groupId: group.body.id } })).status, 200);

  const created = await call('POST', `orgs/${state.orgA}/rights-requests`, { as: ma1, body: { userId: lenaId, rights: RIGHTS.slice(0, 1) } });
  const requestId = created.body.request.id;
  assert.ok((await todosOf(lena)).some(t => t.requestId === requestId && t.status === 'open'));
  assert.ok(!(await todosOf(alice)).some(t => t.requestId === requestId && t.status === 'open'));
  // Org-Admin außerhalb der Gruppe darf ansehen, aber nicht entscheiden.
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests/${requestId}/decision`, { as: alice, body: { decision: 'approve', rights: [] } })).status, 403);

  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests/${requestId}/decision`, { as: lena, body: { decision: 'reject' } })).body.code, 'comment_required');
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests/${requestId}/decision`, { as: lena, body: { decision: 'reject', comment: 'Brauche ich nicht' } })).status, 200);
  const info = (await todosOf(ma1)).find(t => t.requestId === requestId && t.kind === 'info');
  assert.ok(info);
  // Info-To-dos hakt die Kanzlei ab; fremde Benutzer können das nicht.
  assert.equal((await call('POST', `todos/${state.orgA}/${info.id}/done`, { as: lena })).status, 404);
  assert.equal((await call('POST', `todos/${state.orgA}/${info.id}/done`, { as: ma1 })).status, 200);

  await call('PUT', `orgs/${state.orgA}/settings/rights-approver`, { as: alice, body: { type: 'admins' } });
});

test('Deaktivierte Kanzlei-Mitarbeitende und entfernte Zuordnungen verlieren den Zugriff sofort', async () => {
  await call('POST', 'platform/staff', { as: owner, body: { email: ma1.userDetails, active: false } });
  assert.equal((await call('GET', `orgs/${state.orgA}/rights`, { as: ma1 })).status, 404);
  await call('POST', 'platform/staff', { as: owner, body: { email: ma1.userDetails, active: true } });
  assert.equal((await call('GET', `orgs/${state.orgA}/rights`, { as: ma1 })).status, 200);
  await call('PUT', `platform/staff/${encodeURIComponent(ma1.userDetails)}/orgs`, { as: owner, body: { organizationIds: [] } });
  assert.equal((await call('GET', `orgs/${state.orgA}/rights`, { as: ma1 })).status, 404);
  // Support ohne Zuordnung: nur mit Begründung.
  const erinId = await userIdOf(principal('erin', `erin-${run}@a.test`));
  assert.equal((await call('POST', `orgs/${state.orgA}/rights-requests`, { as: owner, body: { userId: erinId, rights: RIGHTS } })).body.code, 'reason_required');
});
