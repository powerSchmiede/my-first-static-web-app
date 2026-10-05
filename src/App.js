import React, { useCallback, useEffect, useState } from 'react';
import './App.css';
import Tile from './Tile';
import { Modal, AppForm, ManageList } from './Admin';
import { fetchApps, fetchMe, LOGIN_URL, LOGOUT_URL } from './api';
import { Link, usePath } from './router';
import Organization from './pages/Organization';
import Platform from './pages/Platform';
import Invitation from './pages/Invitation';

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

// Nur für die Anzeige: Ob eine Aktion erlaubt ist, entscheidet ausschließlich der Server.
function isOrgAdmin(me) {
  const m = me && me.membership;
  return !!m && m.role === 'OrgAdmin' && m.status === 'Active' && m.orgStatus === 'Active';
}

function Home({ isPlatformAdmin }) {
  const [apps, setApps] = useState(null);
  const [loadError, setLoadError] = useState('');
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

  useEffect(() => { load(); }, [load]);

  const closeDialog = () => setDialog(null);

  async function afterSave(fromManage) {
    await load();
    setDialog(fromManage ? { kind: 'manage' } : null);
  }

  return (
    <>
      {isPlatformAdmin && (
        <div className="home-actions">
          <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}>+ Neue App</button>
          <button type="button" className="icon-btn" onClick={() => setDialog({ kind: 'manage' })} aria-label="Apps verwalten" title="Apps verwalten">
            <GearIcon />
          </button>
        </div>
      )}

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

function Notice({ title, children }) {
  return (
    <div className="page page-narrow">
      <div className="panel stack">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function App() {
  const path = usePath();
  const [me, setMe] = useState(null);

  const loadMe = useCallback(async () => {
    try {
      setMe(await fetchMe());
    } catch {
      setMe({ authenticated: false });
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const signedIn = !!me && me.authenticated;
  const platformAdmin = signedIn && me.isPlatformAdmin;
  const orgAdmin = signedIn && isOrgAdmin(me);
  const segments = path.split('/').filter(Boolean).map(decodeURIComponent);

  let page;
  let section = 'apps';
  if (segments[0] === 'einladung') {
    section = '';
    page = me ? <Invitation me={me} onAccepted={loadMe} /> : null;
  } else if (segments[0] === 'organisation') {
    section = 'org';
    if (!me) page = null;
    else if (!signedIn) page = <Notice title="Bitte anmelden"><p><a className="btn btn-primary" href={LOGIN_URL(path)}>Anmelden</a></p></Notice>;
    else if (!orgAdmin) page = <Notice title="Kein Zugriff"><p>Die Benutzerverwaltung steht nur Organization Admins zur Verfügung.</p></Notice>;
    else page = <Organization key={me.membership.organizationId} orgId={me.membership.organizationId} tab={segments[1]} basePath="/organisation" me={me} />;
  } else if (segments[0] === 'plattform') {
    section = 'platform';
    if (!me) page = null;
    else if (!platformAdmin) page = <Notice title="Kein Zugriff"><p>Dieser Bereich ist der Plattform-Verwaltung vorbehalten.</p></Notice>;
    else if (segments[1] === 'org' && segments[2]) {
      const base = `/plattform/org/${encodeURIComponent(segments[2])}`;
      page = <Organization key={segments[2]} orgId={segments[2]} tab={segments[3]} basePath={base} me={me} backLink={<Link to="/plattform" className="back-link">← Alle Organisationen</Link>} />;
    } else page = <Platform />;
  } else {
    page = <Home isPlatformAdmin={platformAdmin} />;
  }

  return (
    <>
      <header className="topbar">
        <Link to="/" className="topbar-title">GKK Apps</Link>
        <nav className="topbar-nav" aria-label="Hauptnavigation">
          {signedIn && (orgAdmin || platformAdmin) && <Link to="/" className={section === 'apps' ? 'is-active' : ''}>Apps</Link>}
          {orgAdmin && <Link to="/organisation" className={section === 'org' ? 'is-active' : ''}>Meine Organisation</Link>}
          {platformAdmin && <Link to="/plattform" className={section === 'platform' ? 'is-active' : ''}>Plattform</Link>}
        </nav>
        <div className="topbar-actions">
          {signedIn ? (
            <>
              <span className="topbar-user" title={me.email}>
                {me.name || me.email}
                {me.membership && <span className="topbar-org">{me.membership.organizationName}</span>}
              </span>
              <a className="btn" href={LOGOUT_URL}>Abmelden</a>
            </>
          ) : me ? (
            <a className="btn" href={LOGIN_URL(path)}>Anmelden</a>
          ) : null}
        </div>
      </header>
      {page}
    </>
  );
}

export default App;
