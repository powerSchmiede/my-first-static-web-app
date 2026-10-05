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
export const createApp = data => request('POST', '/api/manage/apps', data);
export const updateApp = (id, data) => request('PUT', `/api/manage/apps/${enc(id)}`, data);
export const deleteApp = id => request('DELETE', `/api/manage/apps/${enc(id)}`);

// Angemeldeter Benutzer (Organisation und Rolle ermittelt der Server)
export const fetchMe = () => request('GET', '/api/me');

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
export const listPlatformAudit = () => request('GET', '/api/platform/audit');

// Einladung annehmen
export const previewInvitation = token => request('POST', '/api/invitations/preview', { token });
export const acceptInvitation = token => request('POST', '/api/invitations/accept', { token });

export const LOGIN_URL = (redirect = '/') => `/.auth/login/aad?post_login_redirect_uri=${enc(redirect)}`;
export const LOGOUT_URL = '/.auth/logout?post_logout_redirect_uri=/';
