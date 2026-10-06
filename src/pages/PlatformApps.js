import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { Modal, AppForm, ManageList } from '../Admin';
import { ErrorText } from '../ui';
import { PlatformNav } from './Platform';

// KanzleiMind-Apps verwalten (nur Plattform-Admins). Freigeschaltet werden sie pro
// Organisation unter Plattform → Organisation → Freischaltung.
export default function PlatformApps() {
  const [apps, setApps] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { kind: 'create' } | { kind: 'edit', app }

  const load = useCallback(async () => {
    try {
      setApps(await api.fetchAllApps());
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function afterSave() {
    setDialog(null);
    await load();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Plattform-Verwaltung</p>
          <h1>KanzleiMind-Apps</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}>+ Neue App</button>
      </div>
      <PlatformNav active="apps" />
      <ErrorText error={error} />
      <div className="panel stack">
        <p className="hint">Diese Apps kannst du einzelnen Organisationen freischalten. Neue Apps sind zunächst für keine Organisation freigeschaltet.</p>
        {apps ? <ManageList apps={apps} onEdit={app => setDialog({ kind: 'edit', app })} onChanged={load} /> : <p className="hint">Wird geladen …</p>}
      </div>
      {dialog && (
        <Modal title={dialog.kind === 'edit' ? `„${dialog.app.title}“ bearbeiten` : 'Neue KanzleiMind-App'} onClose={() => setDialog(null)}>
          <AppForm app={dialog.app} onSaved={afterSave} onCancel={() => setDialog(null)} />
        </Modal>
      )}
    </div>
  );
}
