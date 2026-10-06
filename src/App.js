import React, { useCallback, useEffect, useState } from 'react';
import './App.css';
import logo from './assets/kanzleimind-logo.png';
import Tile from './Tile';
import { fetchApps, fetchMe, LOGIN_URL, LOGOUT_URL, PROVIDERS } from './api';
import { MicrosoftIcon } from './ui';
import { Link, usePath } from './router';
import Organization from './pages/Organization';
import Platform from './pages/Platform';
import Invitation from './pages/Invitation';
import PlatformApps from './pages/PlatformApps';
import MyAppsDialog from './pages/MyApps';

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

// Mitglieder sehen ihre Apps in ihrer persönlichen Reihenfolge und verwalten sie über
// das Zahnrad. Plattform-Admins ohne Organisation sehen alle KanzleiMind-Apps.
function Home({ canPersonalize, isPlatformAdmin }) {
  const [apps, setApps] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const shown = apps && (canPersonalize ? apps : sortForDisplay(apps));

  return (
    <>
      {(canPersonalize || isPlatformAdmin) && (
        <div className="home-actions">
          {!canPersonalize && isPlatformAdmin && <Link className="btn" to="/plattform/apps">KanzleiMind-Apps verwalten</Link>}
          {canPersonalize && (
            <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Meine Apps verwalten" title="Meine Apps verwalten">
              <GearIcon />
            </button>
          )}
        </div>
      )}

      {loadError && <p className="page-error" role="alert">{loadError}</p>}

      {apps && !apps.length && !loadError && (
        <div className="page page-narrow">
          <div className="panel stack">
            <h1>Noch keine Apps</h1>
            <p className="hint">
              {isPlatformAdmin && !canPersonalize
                ? 'Lege unter Plattform → KanzleiMind-Apps die erste App an.'
                : 'Für dich sind noch keine Apps sichtbar. Über das Zahnrad kannst du eigene Links anlegen oder ausgeblendete Apps wieder einblenden.'}
            </p>
          </div>
        </div>
      )}

      <main className="tiles" aria-busy={apps === null}>
        {shown && shown.map(app => <Tile key={app.key || app.id} app={app} uid={`tile-${app.key || app.id}`} />)}
      </main>

      {settingsOpen && <MyAppsDialog onClose={() => setSettingsOpen(false)} onChanged={load} />}
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

// Startseite für Besucher ohne Anmeldung: keine Apps, nur Erklärung und Login.
function Landing() {
  return (
    <main className="landing">
      <div className="landing-card">
        <img className="landing-logo" src={logo} alt="KanzleiMind" width="986" height="207" />
        <h1>Die digitalen Werkzeuge deiner Kanzlei an einem Ort.</h1>
        <p className="landing-lead">
          KanzleiMind bündelt KI-Anwendungen und Tools für den Kanzleialltag – sicher getrennt pro Organisation
          und nur für die Personen, die du einlädst.
        </p>
        <ul className="landing-points">
          <li>Alle freigegebenen Apps auf einer Startseite</li>
          <li>Zugang nur auf Einladung deiner Organisation</li>
          <li>Anmeldung mit Microsoft 365 oder KanzleiMind-Konto</li>
        </ul>
        <div className="login-options">
          <a className="btn btn-lg btn-microsoft" href={LOGIN_URL('/', PROVIDERS.microsoft)}><MicrosoftIcon /> Mit Microsoft 365 anmelden</a>
          <a className="btn btn-primary btn-lg" href={LOGIN_URL('/', PROVIDERS.email)}>Mit KanzleiMind-Konto anmelden</a>
        </div>
        <p className="hint">
          Noch kein Konto? Am einfachsten öffnest du den Einladungslink aus deiner E-Mail.
          Oder <a href={LOGIN_URL('/', PROVIDERS.signup)}>KanzleiMind-Konto erstellen</a>.
        </p>
      </div>
    </main>
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

  const membership = signedIn ? me.membership : null;
  const blocked = membership && (membership.status !== 'Active' || membership.orgStatus !== 'Active');

  let page;
  let section = 'apps';
  if (!me) {
    page = null;
  } else if (segments[0] === 'einladung') {
    section = '';
    page = me ? <Invitation me={me} onAccepted={loadMe} /> : null;
  } else if (!signedIn) {
    section = 'landing';
    page = <Landing />;
  } else if (!platformAdmin && !membership) {
    section = '';
    page = (
      <Notice title="Noch kein Zugang">
        <p>Du bist als <strong>{me.email}</strong> angemeldet, aber noch keiner Organisation zugeordnet.</p>
        <p className="hint">Öffne den Einladungslink aus deiner E-Mail. Hast du keine Einladung erhalten, wende dich an den Administrator deiner Organisation.</p>
        <p><a className="btn" href={LOGOUT_URL}>Abmelden</a></p>
      </Notice>
    );
  } else if (!platformAdmin && blocked) {
    section = '';
    page = (
      <Notice title="Zugang deaktiviert">
        <p>{membership.orgStatus !== 'Active' ? 'Deine Organisation ist deaktiviert.' : 'Dein Konto wurde deaktiviert.'} Wende dich bei Fragen an deinen Administrator.</p>
        <p><a className="btn" href={LOGOUT_URL}>Abmelden</a></p>
      </Notice>
    );
  } else if (segments[0] === 'organisation') {
    section = 'org';
    if (!orgAdmin) page = <Notice title="Kein Zugriff"><p>Die Benutzerverwaltung steht nur Organization Admins zur Verfügung.</p></Notice>;
    else page = <Organization key={me.membership.organizationId} orgId={me.membership.organizationId} tab={segments[1]} basePath="/organisation" me={me} />;
  } else if (segments[0] === 'plattform') {
    section = 'platform';
    if (!platformAdmin) page = <Notice title="Kein Zugriff"><p>Dieser Bereich ist der Plattform-Verwaltung vorbehalten.</p></Notice>;
    else if (segments[1] === 'apps') page = <PlatformApps />;
    else if (segments[1] === 'org' && segments[2]) {
      const base = `/plattform/org/${encodeURIComponent(segments[2])}`;
      page = <Organization key={segments[2]} orgId={segments[2]} tab={segments[3]} basePath={base} me={me} platformView backLink={<Link to="/plattform" className="back-link">← Alle Organisationen</Link>} />;
    } else page = <Platform />;
  } else {
    page = <Home isPlatformAdmin={platformAdmin} canPersonalize={!!membership && !blocked} />;
  }

  return (
    <>
      <header className="topbar">
        {section === 'landing' ? <span /> : (
          <Link to="/" className="topbar-title" aria-label="KanzleiMind Apps – Startseite">
            <img className="topbar-logo" src={logo} alt="" width="986" height="207" />
            <span className="topbar-suffix">Apps</span>
          </Link>
        )}
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
            section === 'landing' ? null : <a className="btn" href={LOGIN_URL(path)}>Anmelden</a>
          ) : null}
        </div>
      </header>
      {page}
    </>
  );
}

export default App;
