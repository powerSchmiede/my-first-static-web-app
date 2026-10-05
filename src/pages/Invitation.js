import React, { useEffect, useState } from 'react';
import * as api from '../api';
import { Link, navigate } from '../router';
import { ROLE_LABELS, formatDate } from '../labels';

const STORAGE_KEY = 'pendingInvitationToken';

// Das Token steht im URL-Fragment (#token=…) und wird damit nie an Server oder Logs übertragen.
// Für den Umweg über den Login merken wir es uns in der Session und entfernen es aus der Adresszeile.
function takeToken() {
  const match = window.location.hash.match(/token=([A-Za-z0-9_-]+)/);
  if (match) {
    try { sessionStorage.setItem(STORAGE_KEY, match[1]); } catch { /* Session-Speicher nicht verfügbar */ }
    window.history.replaceState({}, '', window.location.pathname);
    return match[1];
  }
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function forgetToken() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignorieren */ }
}

export default function Invitation({ me, onAccepted }) {
  const [token] = useState(takeToken);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(token ? '' : 'Dieser Einladungslink ist unvollständig. Öffne bitte den Link aus der E-Mail erneut.');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.previewInvitation(token).then(setPreview).catch(err => setError(err.message));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError('');
    try {
      await api.acceptInvitation(token);
      forgetToken();
      setDone(true);
      await onAccepted();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const signedIn = me && me.authenticated;
  const emailMismatch = signedIn && preview && me.email && me.email !== preview.email;

  return (
    <div className="page page-narrow">
      <div className="panel stack invitation-card">
        <p className="eyebrow">Einladung</p>
        {done ? (
          <>
            <h1>Willkommen{preview ? ` bei ${preview.organizationName}` : ''}!</h1>
            <p>Du bist jetzt Mitglied der Organisation.</p>
            <div className="form-actions"><button type="button" className="btn btn-primary" onClick={() => navigate('/')}>Zu den Apps</button></div>
          </>
        ) : preview ? (
          <>
            <h1>{preview.organizationName}</h1>
            <p>Du wurdest als <strong>{ROLE_LABELS[preview.role]}</strong> eingeladen.</p>
            <dl className="details">
              <dt>E-Mail</dt><dd>{preview.email}</dd>
              <dt>Gültig bis</dt><dd>{formatDate(preview.expiresAt)}</dd>
            </dl>
            {preview.status !== 'Pending' ? (
              <p className="notice notice-warn">
                {preview.status === 'Expired' ? 'Diese Einladung ist abgelaufen. Bitte deinen Administrator um eine neue Einladung.' : 'Diese Einladung ist nicht mehr gültig.'}
              </p>
            ) : !signedIn ? (
              <>
                <p className="hint">Melde dich mit deinem Microsoft-Konto <strong>{preview.email}</strong> an, um die Einladung anzunehmen.</p>
                <div className="form-actions"><a className="btn btn-primary" href={api.LOGIN_URL('/einladung')}>Anmelden & annehmen</a></div>
              </>
            ) : emailMismatch ? (
              <>
                <p className="notice notice-warn">
                  Du bist als <strong>{me.email}</strong> angemeldet. Diese Einladung gilt nur für <strong>{preview.email}</strong>.
                  Melde dich ab und mit dem richtigen Konto wieder an.
                </p>
                <div className="form-actions"><a className="btn" href={api.LOGOUT_URL}>Abmelden</a></div>
              </>
            ) : (
              <div className="form-actions">
                <Link className="btn" to="/">Später</Link>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={accept}>{busy ? 'Wird angenommen …' : 'Einladung annehmen'}</button>
              </div>
            )}
          </>
        ) : !error ? (
          <p className="hint">Einladung wird geprüft …</p>
        ) : null}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
