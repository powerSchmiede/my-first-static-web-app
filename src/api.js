async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    let message = '';
    let code;
    try {
      const data = await response.json();
      message = data.error || '';
      code = data.code;
    } catch {
      // Antwort ohne JSON, z. B. direkt von der Static Web App
    }
    if (!message) {
      message = response.status === 401 ? 'Bitte melde dich an.'
        : response.status === 403 ? 'Dafür fehlt dir die Berechtigung.'
        : response.status === 404 ? 'Nicht gefunden.'
        : `Fehler ${response.status}`;
    }
    const error = new Error(message);
    error.status = response.status;
    error.code = code;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

const enc = encodeURIComponent;

// Kacheln
export const fetchApps = () => request('GET', '/api/apps');
export const fetchAllApps = () => request('GET', '/api/manage/apps');
export const createApp = data =>request('POST', '/api/manage/apps', data);
export const updateApp = (id, data) => request('PUT', `/api/manage/apps/${enc(id)}`, data);
export const deleteApp = id => request('DELETE', `/api/manage/apps/${enc(id)}`);

// Angemeldeter Benutzer (Organisation und Rolle ermittelt der Server)
export const fetchMe = () => request('GET', '/api/me');

// Persönliche Apps und Einstellungen (immer nur die eigenen)
export const fetchMyApps = () => request('GET', '/api/me/apps');
export const saveMyAppSettings = settings => request('PUT', '/api/me/app-settings', settings);
export const createMyApp = data => request('POST', '/api/me/apps', data);
export const updateMyApp = (id, data) => request('PUT', `/api/me/apps/${enc(id)}`, data);
export const deleteMyApp = id => request('DELETE', `/api/me/apps/${enc(id)}`);

// App-Katalog der Organisation (Org-Admins)
export const getCatalog = orgId => request('GET', `/api/orgs/${enc(orgId)}/catalog`);
export const setCatalogAppEnabled = (orgId, appId, enabled) => request('PATCH', `/api/orgs/${enc(orgId)}/catalog/${enc(appId)}`, { enabled });
export const createOrgApp = (orgId, data) => request('POST', `/api/orgs/${enc(orgId)}/apps`, data);
export const updateOrgApp = (orgId, id, data) => request('PATCH', `/api/orgs/${enc(orgId)}/apps/${enc(id)}`, data);
export const deleteOrgApp = (orgId, id) => request('DELETE', `/api/orgs/${enc(orgId)}/apps/${enc(id)}`);

// Organisation
export const getOrganization = orgId => request('GET', `/api/orgs/${enc(orgId)}`);
export const renameOrganization = (orgId, name) => request('PATCH', `/api/orgs/${enc(orgId)}`, { name });
export const listUsers = orgId => request('GET', `/api/orgs/${enc(orgId)}/users`);
export const updateUser = (orgId, userId, patch) => request('PATCH', `/api/orgs/${enc(orgId)}/users/${enc(userId)}`, patch);
export const removeUser = (orgId, userId) => request('DELETE', `/api/orgs/${enc(orgId)}/users/${enc(userId)}`);
export const listInvitations = orgId => request('GET', `/api/orgs/${enc(orgId)}/invitations`);
export const inviteUser = (orgId, data) => request('POST', `/api/orgs/${enc(orgId)}/invitations`, data);
export const resendInvitation = (orgId, id) => request('POST', `/api/orgs/${enc(orgId)}/invitations/${enc(id)}/resend`);
export const revokeInvitation = (orgId, id) => request('DELETE', `/api/orgs/${enc(orgId)}/invitations/${enc(id)}`);
export const listAudit = orgId => request('GET', `/api/orgs/${enc(orgId)}/audit`);

// Plattform
export const listOrganizations = () => request('GET', '/api/platform/orgs');
export const createOrganization = data => request('POST', '/api/platform/orgs', data);
export const setOrganizationStatus = (orgId, status) => request('PATCH', `/api/platform/orgs/${enc(orgId)}`, { status });
export const deleteOrganization = (orgId, confirmName) => request('POST', `/api/platform/orgs/${enc(orgId)}/delete`, { confirmName });
export const listPlatformAudit =() => request('GET', '/api/platform/audit');
export const getOrganizationApps = orgId => request('GET', `/api/platform/orgs/${enc(orgId)}/apps`);
export const setOrganizationApps = (orgId, appIds) => request('PUT', `/api/platform/orgs/${enc(orgId)}/apps`, { appIds });

// Einladung annehmen
export const previewInvitation = token => request('POST', '/api/invitations/preview', { token });
export const acceptInvitation = token => request('POST', '/api/invitations/accept', { token });

// Anbieternamen aus staticwebapp.config.json
export const PROVIDERS = {
  email: 'kanzleimind', // KanzleiMind-Konto anmelden
  signup: 'kanzleimindsignup', // KanzleiMind-Konto erstellen (öffnet direkt die Registrierung)
  microsoft: 'aad', // Microsoft-365-Konto der Kanzlei
};

export const LOGIN_URL = (redirect = '/', provider = PROVIDERS.email) =>
  `/.auth/login/${provider}?post_login_redirect_uri=${enc(redirect)}`;
export const LOGOUT_URL = '/.auth/logout?post_logout_redirect_uri=/';
