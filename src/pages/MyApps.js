import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { Modal, AppForm } from '../Admin';
import { TileArt } from '../Tile';
import { ErrorText } from '../ui';

const SOURCE_LABELS = {
  platform: 'KanzleiMind',
  org: 'Organisation',
  user: 'Eigene App',
};

const LINK_ONLY = ['link'];
const saveOwnApp = (app, data) => (app ? api.updateMyApp(app.id, data) : api.createMyApp(data));

// Persönliche App-Einstellungen: ein-/ausblenden, Reihenfolge, eigene Links.
// Änderungen an Reihenfolge und Sichtbarkeit werden sofort gespeichert.
export default function MyAppsDialog({ onClose, onChanged }) {
  const [apps, setApps] = useState(null);
  const [maxOwnApps, setMaxOwnApps] = useState(30);
  const [view, setView] = useState({ kind: 'list' }); // { kind: 'list' | 'create' | 'edit', app }
  const [confirmId, setConfirmId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.fetchMyApps();
      setApps(result.apps);
      setMaxOwnApps(result.maxOwnApps);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function persist(next) {
    setApps(next);
    setSaving(true);
    setError('');
    try {
      await api.saveMyAppSettings({ order: next.map(app => app.key), hidden: next.filter(app => app.hidden).map(app => app.key) });
      onChanged();
    } catch (err) {
      setError(err.message);
      await load();
    } finally {
      setSaving(false);
    }
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= apps.length) return;
    const next = [...apps];
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  }

  function toggle(app) {
    persist(apps.map(a => (a.key === app.key ? { ...a, hidden: !a.hidden } : a)));
  }

  async function removeOwn(app) {
    setError('');
    try {
      await api.deleteMyApp(app.id);
      setConfirmId(null);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function afterSave() {
    setView({ kind: 'list' });
    await load();
    onChanged();
  }

  if (view.kind !== 'list') {
    return (
      <Modal title={view.kind === 'edit' ? `„${view.app.title}“ bearbeiten` : 'Eigene App anlegen'} onClose={() => setView({ kind: 'list' })}>
        <AppForm
          app={view.app}
          types={LINK_ONLY}
          save={saveOwnApp}
          urlHint="Nur https-Adressen. Diese App siehst nur du."
          onSaved={afterSave}
          onCancel={() => setView({ kind: 'list' })}
        />
      </Modal>
    );
  }

  const ownCount = apps ? apps.filter(app => app.source === 'user').length : 0;

  return (
    <Modal title="Meine Apps" onClose={onClose}>
      <div className="stack">
        <div className="panel-head my-apps-head">
          <p className="hint">Blende Apps aus, ändere die Reihenfolge oder lege eigene Links an. Änderungen werden sofort gespeichert{saving ? ' …' : '.'}</p>
          <button type="button" className="btn btn-primary" disabled={ownCount >= maxOwnApps} onClick={() => setView({ kind: 'create' })}>+ Eigene App</button>
        </div>
        <ErrorText error={error} />
        {!apps ? <p className="hint">Wird geladen …</p> : !apps.length ? <p className="hint">Noch keine Apps vorhanden.</p> : (
          <ul className="manage-list">
            {apps.map((app, index) => (
              <li key={app.key} className={`manage-row my-app-row ${app.hidden ? 'is-hidden' : ''}`}>
                <div className="order-btns">
                  <button type="button" className="icon-btn icon-btn-sm" disabled={index === 0 || saving} onClick={() => move(index, -1)} aria-label={`${app.title} nach oben`}>↑</button>
                  <button type="button" className="icon-btn icon-btn-sm" disabled={index === apps.length - 1 || saving} onClick={() => move(index, 1)} aria-label={`${app.title} nach unten`}>↓</button>
                </div>
                <TileArt uid={`mine-${app.key}`} icon={app.icon} background={app.background} iconSize={20} className="tile-art-mini" />
                <div className="manage-info">
                  <strong>{app.title}</strong>
                  <span>{SOURCE_LABELS[app.source]}{app.type === 'link' ? ` · ${app.url}` : ''}</span>
                </div>
                <div className="manage-actions">
                  <label className="switch" title={app.hidden ? 'Ausgeblendet' : 'Angezeigt'}>
                    <input type="checkbox" checked={!app.hidden} disabled={saving} onChange={() => toggle(app)} />
                    <span className="switch-track" aria-hidden="true" />
                    <span className="switch-label">{app.hidden ? 'Ausgeblendet' : 'Angezeigt'}</span>
                  </label>
                  {app.source === 'user' && (confirmId === app.id ? (
                    <>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => removeOwn(app)}>Löschen</button>
                      <button type="button" className="btn btn-sm" onClick={() => setConfirmId(null)}>Abbrechen</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn btn-sm" onClick={() => setView({ kind: 'edit', app })}>Bearbeiten</button>
                      <button type="button" className="btn btn-sm" onClick={() => setConfirmId(app.id)}>Löschen</button>
                    </>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {ownCount >= maxOwnApps && <p className="hint">Du hast die Höchstzahl von {maxOwnApps} eigenen Apps erreicht.</p>}
      </div>
    </Modal>
  );
}
