import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { Modal, AppForm, ManageList, TYPE_LABELS } from '../Admin';
import { TileArt } from '../Tile';
import { Badge, ErrorText } from '../ui';

const LINK_ONLY = ['link'];

function VisibilitySwitch({ checked, disabled, onChange }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-label">{checked ? 'Für Benutzer sichtbar' : 'Nicht sichtbar'}</span>
    </label>
  );
}

// App-Katalog einer Organisation: freigeschaltete KanzleiMind-Apps sichtbar schalten
// und eigene Link-Apps der Organisation verwalten. Rechte prüft der Server.
export default function Catalog({ orgId }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: 'create' } | { kind: 'edit', app }

  const load = useCallback(async () => {
    try {
      setCatalog(await api.getCatalog(orgId));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function run(id, action) {
    setBusyId(id);
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const saveOrgApp = (app, data) => (app ? api.updateOrgApp(orgId, app.id, data) : api.createOrgApp(orgId, data));

  if (!catalog) return <div className="panel">{error ? <ErrorText error={error} /> : <p className="hint">Wird geladen …</p>}</div>;

  const newCount = catalog.platformApps.filter(app => !app.enabled).length;

  return (
    <div className="stack-lg">
      <ErrorText error={error} />

      <div className="panel stack">
        <div className="panel-head">
          <div>
            <h3>KanzleiMind-Apps {newCount > 0 && <Badge tone="blue">{newCount} neu</Badge>}</h3>
            <p className="hint">Vom Plattform-Betreiber für eure Organisation freigeschaltet. Lege fest, welche davon eure Benutzer sehen.</p>
          </div>
        </div>
        {!catalog.platformApps.length ? <p className="hint">Für eure Organisation sind noch keine KanzleiMind-Apps freigeschaltet.</p> : (
          <ul className="manage-list">
            {catalog.platformApps.map(app => (
              <li key={app.id} className="manage-row">
                <TileArt uid={`cat-${app.id}`} icon={app.icon} background={app.background} iconSize={20} className="tile-art-mini" />
                <div className="manage-info">
                  <strong>{app.title}</strong>
                  <span>{TYPE_LABELS[app.type]}</span>
                </div>
                <div className="manage-actions">
                  {app.type === 'html' && <a className="btn btn-sm" href={`/api/apps/${encodeURIComponent(app.id)}/html`} target="_blank" rel="noopener noreferrer">Testen</a>}
                  <VisibilitySwitch checked={app.enabled} disabled={busyId === app.id} onChange={enabled => run(app.id, () => api.setCatalogAppEnabled(orgId, app.id, enabled))} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel stack">
        <div className="panel-head">
          <div>
            <h3>Apps der Organisation</h3>
            <p className="hint">Eigene Links für eure Organisation, z. B. SharePoint-Seiten oder Fachportale. Nur https-Adressen.</p>
          </div>
          <button type="button" className="btn btn-primary" disabled={catalog.orgApps.length >= catalog.maxOrgApps} onClick={() => setDialog({ kind: 'create' })}>+ Neue App</button>
        </div>
        <ManageList
          apps={catalog.orgApps}
          emptyText="Noch keine eigenen Apps angelegt."
          onEdit={app => setDialog({ kind: 'edit', app })}
          onChanged={load}
          remove={id => api.deleteOrgApp(orgId, id)}
          extra={app => (
            <VisibilitySwitch checked={app.enabled} disabled={busyId === app.id} onChange={enabled => run(app.id, () => api.updateOrgApp(orgId, app.id, { enabled }))} />
          )}
        />
      </div>

      {dialog && (
        <Modal title={dialog.kind === 'edit' ? `„${dialog.app.title}“ bearbeiten` : 'Neue App für die Organisation'} onClose={() => setDialog(null)}>
          <AppForm
            app={dialog.app}
            types={LINK_ONLY}
            save={saveOrgApp}
            urlHint="Nur https-Adressen. Externe Seiten öffnen sich in einem neuen Tab."
            onSaved={async () => { setDialog(null); await load(); }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}
    </div>
  );
}
