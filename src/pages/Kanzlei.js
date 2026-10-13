import React, { useEffect, useState } from 'react';
import * as api from '../api';
import { Link } from '../router';
import { Badge, ErrorText } from '../ui';
import SystemRightsOverview from './SystemRights';

// Bereich für Kanzlei-Mitarbeitende: zugeordnete Mandanten und deren DATEV-Rechte.
export default function Kanzlei({ orgId }) {
  const [mandanten, setMandanten] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.fetchMandanten().then(setMandanten).catch(err => setError(err.message));
  }, [orgId]);

  if (orgId) {
    const current = (mandanten || []).find(m => m.id === orgId);
    return (
      <div className="page">
        <SystemRightsOverview
          orgId={orgId}
          backLink={<Link to="/kanzlei" className="back-link">← Alle Mandanten</Link>}
          title={<div className="page-head"><div><p className="eyebrow">Mandant</p><h1>{current ? current.name : 'Mandant'}</h1></div></div>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Kanzlei</p>
          <h1>Meine Mandanten</h1>
        </div>
      </div>
      <ErrorText error={error} />
      {!mandanten ? <p className="hint">Wird geladen …</p> : !mandanten.length ? (
        <div className="panel"><p className="hint">Dir sind noch keine Mandanten zugeordnet. Wende dich an die Plattform-Verwaltung.</p></div>
      ) : (
        <div className="mandant-grid">
          {mandanten.map(m => (
            <Link key={m.id} to={`/kanzlei/${encodeURIComponent(m.id)}`} className="panel mandant-card">
              <strong>{m.name}</strong>
              <div className="chip-row">
                {m.status !== 'Active' && <Badge tone="gray">deaktiviert</Badge>}
                {m.pending > 0 && <Badge tone="blue">{m.pending} wartet auf Freigabe</Badge>}
                {m.toImplement > 0 && <Badge tone="amber">{m.toImplement} umzusetzen</Badge>}
                {!m.pending && !m.toImplement && <span className="muted small">Keine offenen Anträge</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
