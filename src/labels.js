export const ROLE_LABELS = {
  OrgAdmin: 'Organization Admin',
  OrgUser: 'Organization User',
};

export const USER_STATUS_LABELS = {
  Active: 'Active',
  Disabled: 'Disabled',
  Invited: 'Invited',
};

export const INVITATION_STATUS_LABELS = {
  Pending: 'Offen',
  Accepted: 'Angenommen',
  Revoked: 'Zurückgezogen',
  Expired: 'Abgelaufen',
};

export const AUDIT_LABELS = {
  'organization.created': 'Organisation erstellt',
  'organization.renamed': 'Organisation umbenannt',
  'organization.disabled': 'Organisation deaktiviert',
  'organization.enabled': 'Organisation aktiviert',
  'organization.apps_changed': 'App-Freigaben geändert',
  'organization.deleted': 'Organisation gelöscht',
  'invitation.created': 'Benutzer eingeladen',
  'invitation.resent': 'Einladung erneut gesendet',
  'invitation.revoked': 'Einladung zurückgezogen',
  'invitation.accepted': 'Einladung angenommen',
  'invitation.accept_failed': 'Einladung: Annahme fehlgeschlagen',
  'user.role_changed': 'Rolle geändert',
  'user.disabled': 'Benutzer deaktiviert',
  'user.enabled': 'Benutzer aktiviert',
  'user.removed': 'Benutzer entfernt',
  'access.denied': 'Zugriff verweigert',
  'platform_admin.registered': 'Plattform-Admin registriert',
  'app.created': 'App angelegt',
  'app.updated': 'App geändert',
  'app.deleted': 'App gelöscht',
};

export function formatDate(value, withTime = true) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE', withTime
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function absoluteLink(link) {
  return /^https?:\/\//.test(link) ? link : `${window.location.origin}${link}`;
}
