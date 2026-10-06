import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { TileArt } from '../Tile';
import { ErrorText } from '../ui';

// Auswahlliste für App-Freigaben. Die eigentliche Prüfung macht der Server.
export function AppChecklist({ apps, selected, onChange, disabled }) {
  if (!apps) return <p className="hint">Apps werden geladen …</p>;
  if (!apps.length) return <p className="hint">Es gibt noch keine Apps.</p>;

  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  const allSelected = apps.every(app => selected.has(app.id));

  return (
    <div className="app-checklist">
      <div className="app-checklist-head">
        <span>{selected.size} von {apps.length} ausgewählt</span>
        <button type="button" className="link-btn" disabled={disabled} onClick={() => onChange(allSelected ? new Set() : new Set(apps.map(app => app.id)))}>
          {allSelected ? 'Keine auswählen' : 'Alle auswählen'}
        </button>
      </div>
      <ul>
        {apps.map(app => (
          <li key={app.id}>
            <label className={`app-check ${selected.has(app.id) ? 'is-selected' : ''}`}>
              <input type="checkbox" checked={selected.has(app.id)} disabled={disabled} onChange={() => toggle(app.id)} />
              <TileArt uid={`check-${app.id}`} icon={app.icon} background={app.background} iconSize={20} className="tile-art-mini" />
              <span className="app-check-title">
                {app.title}
                {app.type === 'none' && <span className="muted small"> · Demnächst</span>}
                {app.type === 'link' && <span className="muted small"> · Link</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function useAllApps() {
  const [apps, setApps] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.fetchApps().then(setApps).catch(err => setError(err.message));
  }, []);
  return { apps, error };
}

// Reiter "Apps" in der Plattform-Ansicht einer Organisation.
export default function OrganizationApps({ orgId, onSaved }) {
  const { apps, error: appsError } = useAllApps();
  const [saved, setSaved] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const { appIds } = await api.getOrganizationApps(orgId);
      setSaved(new Set(appIds));
      setSelected(new Set(appIds));
    } catch (err) {
      setError(err.message);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const dirty = !!saved && (saved.size !== selected.size || [...selected].some(id => !saved.has(id)));

  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { appIds } = await api.setOrganizationApps(orgId, [...selected]);
      setSaved(new Set(appIds));
      setSelected(new Set(appIds));
      setNotice('Freigaben gespeichert.');
      if (onSaved) onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel stack">
      <div className="panel-head">
        <div>
          <h3>Freigegebene Apps</h3>
          <p className="hint">Benutzer dieser Organisation sehen nur die hier ausgewählten Apps. Neue Apps sind zunächst nirgends freigegeben.</p>
        </div>
        <div className="panel-actions">
          {dirty && <button type="button" className="btn" disabled={busy} onClick={() => setSelected(new Set(saved))}>Verwerfen</button>}
          <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Speichern …' : 'Speichern'}</button>
        </div>
      </div>
      <ErrorText error={appsError || error} />
      {notice && !dirty && <p className="notice notice-success">{notice}</p>}
      {saved ? <AppChecklist apps={apps} selected={selected} onChange={next => { setSelected(next); setNotice(''); }} disabled={busy} /> : <p className="hint">Wird geladen …</p>}
      <p className="hint">Externe Links (z. B. SharePoint) werden nur ausgeblendet. Ihr Ziel muss selbst geschützt sein.</p>
    </div>
  );
}
