import React, { useCallback, useEffect, useState } from 'react';
import './App.css';
import Tile from './Tile';
import { Modal, AppForm, ManageList } from './Admin';
import { fetchApps, fetchUser } from './api';

const LOGIN_URL = '/.auth/login/aad?post_login_redirect_uri=/';
const LOGOUT_URL = '/.auth/logout?post_logout_redirect_uri=/';

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

// Aktive Kacheln (mit Ziel) zuerst, sonst gilt die gespeicherte Reihenfolge.
function sortForDisplay(apps) {
  return [
    ...apps.filter(app => app.type !== 'none'),
    ...apps.filter(app => app.type === 'none'),
  ];
}

function App() {
  const [apps, setApps] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [user, setUser] = useState(null);
  // { kind: 'create' } | { kind: 'manage' } | { kind: 'edit', app }
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    try {
      setApps(await fetchApps());
      setLoadError('');
    } catch {
      setLoadError('Die Apps konnten nicht geladen werden. Bitte die Seite neu laden.');
      setApps(current => current || []);
    }
  }, []);

  useEffect(() => {
    load();
    fetchUser().then(setUser);
  }, [load]);

  const isAdmin = !!user && (user.userRoles || []).includes('admin');
  const closeDialog = () => setDialog(null);

  async function afterSave(fromManage) {
    await load();
    setDialog(fromManage ? { kind: 'manage' } : null);
  }

  return (
    <>
      <header className="topbar">
        <span className="topbar-title">GKK Apps</span>
        <div className="topbar-actions">
          {isAdmin && (
            <>
              <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}>+ Neue App</button>
              <button type="button" className="icon-btn" onClick={() => setDialog({ kind: 'manage' })} aria-label="Apps verwalten" title="Apps verwalten">
                <GearIcon />
              </button>
            </>
          )}
          {user ? (
            <>
              <span className="topbar-user" title={user.userDetails}>{user.userDetails}</span>
              <a className="btn" href={LOGOUT_URL}>Abmelden</a>
            </>
          ) : (
            <a className="btn" href={LOGIN_URL}>Anmelden</a>
          )}
        </div>
      </header>

      {loadError && <p className="page-error" role="alert">{loadError}</p>}

      <main className="tiles" aria-busy={apps === null}>
        {apps && sortForDisplay(apps).map(app => <Tile key={app.id} app={app} />)}
      </main>

      {dialog && dialog.kind === 'create' && (
        <Modal title="Neue App anlegen" onClose={closeDialog}>
          <AppForm onSaved={() => afterSave(false)} onCancel={closeDialog} />
        </Modal>
      )}
      {dialog && dialog.kind === 'manage' && (
        <Modal title="Apps verwalten" onClose={closeDialog}>
          <ManageList apps={apps || []} onEdit={app => setDialog({ kind: 'edit', app })} onChanged={load} />
        </Modal>
      )}
      {dialog && dialog.kind === 'edit' && (
        <Modal title={`„${dialog.app.title}“ bearbeiten`} onClose={() => setDialog({ kind: 'manage' })}>
          <AppForm app={dialog.app} onSaved={() => afterSave(true)} onCancel={() => setDialog({ kind: 'manage' })} />
        </Modal>
      )}
    </>
  );
}

export default App;
