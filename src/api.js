async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Keine Berechtigung. Bitte als Admin anmelden.');
    }
    let message = `Fehler ${response.status}`;
    try {
      const data = await response.json();
      if (data.error) message = data.error;
    } catch {
      // Antwort ohne JSON
    }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

export const fetchApps = () => request('GET', '/api/apps');
export const createApp = data => request('POST', '/api/manage/apps', data);
export const updateApp = (id, data) => request('PUT', `/api/manage/apps/${encodeURIComponent(id)}`, data);
export const deleteApp = id => request('DELETE', `/api/manage/apps/${encodeURIComponent(id)}`);

export async function fetchUser() {
  try {
    const response = await fetch('/.auth/me');
    if (!response.ok) return null;
    const data = await response.json();
    return data.clientPrincipal || null;
  } catch {
    return null;
  }
}
