import React, { useEffect, useState } from 'react';
import { fetchApps } from '../api';
import { Link } from '../router';

// Gleiche Rechte wie die serverseitige Content-Security-Policy der App. Ohne allow-same-origin
// läuft die App mit eigenem, undurchsichtigem Ursprung: kein Zugriff auf KanzleiMind,
// Cookies oder die Sitzung. Ohne allow-top-navigation kann sie die Seite nicht umleiten.
const SANDBOX = 'allow-scripts allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals';

// Zeigt eine eigene HTML-App innerhalb der Oberfläche, damit die Navigation sichtbar bleibt.
// Ob die App geöffnet werden darf, prüft der Server beim Laden des Inhalts.
export default function AppViewer({ appId }) {
  const [app, setApp] = useState(undefined);

  useEffect(() => {
    let active = true;
    fetchApps()
      .then(apps => { if (active) setApp(apps.find(a => a.source === 'platform' && a.id === appId && a.type === 'html') || null); })
      .catch(() => { if (active) setApp(null); });
    return () => { active = false; };
  }, [appId]);

  if (app === undefined) return <div className="page"><p className="hint">Wird geladen …</p></div>;
  if (app === null) {
    return (
      <div className="page page-narrow">
        <div className="panel stack">
          <h1>App nicht verfügbar</h1>
          <p className="hint">Diese App gibt es nicht oder sie ist für dich nicht freigegeben.</p>
          <p><Link className="btn" to="/">Zu meinen Apps</Link></p>
        </div>
      </div>
    );
  }

  const src = `/api/apps/${encodeURIComponent(app.id)}/html`;
  return (
    <div className="app-viewer">
      <div className="app-viewer-bar">
        <Link to="/" className="back-link">← Apps</Link>
        <strong>{app.title}</strong>
        <a className="btn btn-sm" href={src} target="_blank" rel="noopener noreferrer">In neuem Tab öffnen</a>
      </div>
      <iframe className="app-viewer-frame" src={src} title={app.title} sandbox={SANDBOX} referrerPolicy="no-referrer" />
    </div>
  );
}
