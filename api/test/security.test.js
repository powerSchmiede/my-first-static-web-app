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

const functions = require('@azure/functions');
const routes = [];
functions.app.http = (name, options) => routes.push({ name, ...options });
require('../src/functions/organizations');
require('../src/functions/apps');

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