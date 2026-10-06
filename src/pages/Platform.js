import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { Link } from '../router';
import { Modal } from '../Admin';
import { Badge, ErrorText, InviteResult, StatCard, STATUS_TONES } from '../ui';
import { formatDate } from '../labels';
import { AuditList } from './Organization';
import { AppChecklist, useAllApps } from './AppAccess';

function CreateOrganizationDialog({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [appIds, setAppIds] = useState(new Set());
  const { apps, error: appsError } = useAllApps();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await api.createOrganization({ name: name.trim(), adminEmail: adminEmail.trim(), appIds: [...appIds] });
      setResult(response);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Neue Organisation" onClose={onClose}>
      {result ? (
        <>
          <p className="notice notice-success">Die Organisation <strong>{result.organization.name}</strong> wurde angelegt.</p>
          <InviteResult result={result} />
          <div className="form-actions"><button type="button" className="btn btn-primary" onClick={onClose}>Fertig</button></div>
        </>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <label className="field">
            <span>Name der Organisation</span>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="z. B. Muster GmbH" required />
          </label>
          <label className="field">
            <span>E-Mail des ersten Organization Admins</span>
            <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="admin@kunde.de" autoComplete="off" required />
            <small>Diese Person erhält eine Einladung und wird nach der Anmeldung Organization Admin.</small>
          </label>
          <fieldset className="field">
            <legend>Freigegebene Apps</legend>
            <AppChecklist apps={apps} selected={appIds} onChange={setAppIds} disabled={busy} />
            <ErrorText error={appsError} />
          </fieldset>
          <ErrorText error={error} />
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Abbrechen</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !adminEmail.trim()}>{busy ? 'Anlegen …' : 'Anlegen & einladen'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function DeleteOrganizationDialog({ org, onClose, onDeleted }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matches = confirm.trim() === org.name;

  async function submit(e) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteOrganization(org.id, confirm.trim());
      onDeleted();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Organisation endgültig löschen" onClose={busy ? () => {} : onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="notice notice-warn">
          <strong>{org.name}</strong> wird mit allen Benutzerzuordnungen, Einladungen, App-Freigaben und dem Protokoll der
          Organisation gelöscht. Das lässt sich nicht rückgängig machen.
        </p>
        <p className="hint">
          Die Login-Konten der Benutzer bleiben bestehen; sie haben danach keinen Zugriff mehr und können neu eingeladen werden.
          Im Plattform-Protokoll bleibt vermerkt, wer die Organisation gelöscht hat.
        </p>
        <label className="field">
          <span>Zur Bestätigung den Namen eingeben: <strong>{org.name}</strong></span>
          <input value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" autoFocus />
        </label>
        <ErrorText error={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button type="submit" className="btn btn-danger" disabled={busy || !matches}>{busy ? 'Löschen …' : 'Endgültig löschen'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Platform() {
  const [orgs, setOrgs] = useState(null);
  const [audit, setAudit] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    try {
      const [o, a] = await Promise.all([api.listOrganizations(), api.listPlatformAudit()]);
      setOrgs(o.sort((x, y) => x.name.localeCompare(y.name, 'de')));
      setAudit(a);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(org) {
    setBusyId(org.id);
    setError('');
    try {
      await api.setOrganizationStatus(org.id, org.status === 'Active' ? 'Disabled' : 'Active');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const totals = (orgs || []).reduce((sum, o) => ({
    users: sum.users + o.stats.users,
    pending: sum.pending + o.stats.pendingInvitations,
    active: sum.active + (o.status === 'Active' ? 1 : 0),
  }), { users: 0, pending: 0, active: 0 });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Plattform-Verwaltung</p>
          <h1>Organisationen</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>+ Neue Organisation</button>
      </div>

      <ErrorText error={error} />

      {orgs && (
        <div className="stat-grid">
          <StatCard label="Organisationen" value={orgs.length} hint={`${totals.active} aktiv`} />
          <StatCard label="Benutzer gesamt" value={totals.users} tone="green" />
          <StatCard label="Offene Einladungen" value={totals.pending} tone="blue" />
        </div>
      )}

      <div className="panel">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Organisation</th><th>Status</th><th>Benutzer</th><th>Offene Einladungen</th><th>Erstellt</th><th><span className="sr-only">Aktionen</span></th></tr>
            </thead>
            <tbody>
              {!orgs && <tr><td colSpan="6" className="empty">Wird geladen …</td></tr>}
              {orgs && orgs.map(org => (
                <tr key={org.id}>
                  <td><Link to={`/plattform/org/${encodeURIComponent(org.id)}`} className="cell-link">{org.name}</Link></td>
                  <td><Badge tone={STATUS_TONES[org.status]}>{org.status}</Badge></td>
                  <td>{org.stats.activeUsers} / {org.stats.users}<div className="muted small">aktiv / gesamt</div></td>
                  <td>{org.stats.pendingInvitations}</td>
                  <td>{formatDate(org.createdAt, false)}</td>
                  <td className="cell-actions">
                    <Link className="btn btn-sm" to={`/plattform/org/${encodeURIComponent(org.id)}/benutzer`}>Benutzer</Link>
                    <button type="button" className="btn btn-sm" disabled={busyId === org.id} onClick={() => toggle(org)}>
                      {org.status === 'Active' ? 'Deaktivieren' : 'Aktivieren'}
                    </button>
                    {org.status !== 'Active' && (
                      <button type="button" className="btn btn-sm btn-danger-outline" disabled={busyId === org.id} onClick={() => setDeleting(org)}>Löschen</button>
                    )}
                  </td>
                </tr>
              ))}
              {orgs && !orgs.length && <tr><td colSpan="6" className="empty">Noch keine Organisationen. Lege die erste an.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Plattform-Protokoll</h3></div>
        <AuditList entries={audit} />
      </div>

      {creating && <CreateOrganizationDialog onClose={() => setCreating(false)} onCreated={load} />}
      {deleting && <DeleteOrganizationDialog org={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); load(); }} />}
    </div>
  );
}
