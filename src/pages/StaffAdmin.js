import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { Modal } from '../Admin';
import { Badge, ErrorText } from '../ui';
import { PlatformNav } from './Platform';

function AssignDialog({ member, orgs, onClose, onSaved }) {
  const [selected, setSelected] = useState(new Set(member.organizations.map(o => o.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = id => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.setStaffOrgs(member.email, [...selected]);
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Mandanten für ${member.name || member.email}`} onClose={onClose}>
      <div className="stack">
        <p className="hint">Die Mitarbeiterin bzw. der Mitarbeiter sieht nur diese Mandanten und kann dort DATEV-Rechte vorbefüllen und umsetzen.</p>
        <div className="check-grid member-grid">
          {orgs.map(o => (
            <label key={o.id} className={`app-check ${selected.has(o.id) ? 'is-selected' : ''}`}>
              <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
              <span className="app-check-title">{o.name}</span>
            </label>
          ))}
        </div>
        <ErrorText error={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Speichern ({selected.size})</button>
        </div>
      </div>
    </Modal>
  );
}

// Plattform → Kanzlei-Team: Mitarbeitende anlegen, (de)aktivieren und Mandanten zuordnen.
export default function StaffAdmin() {
  const [staff, setStaff] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([api.fetchStaff(), api.listOrganizations()]);
      setStaff(s);
      setOrgs(o.sort((a, b) => a.name.localeCompare(b.name, 'de')));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function run(action) {
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function add(e) {
    e.preventDefault();
    await run(() => api.saveStaff({ email: email.trim(), name: name.trim() }));
    setEmail('');
    setName('');
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Plattform-Verwaltung</p>
          <h1>Kanzlei-Team</h1>
        </div>
      </div>
      <PlatformNav active="team" />
      <ErrorText error={error} />

      <form className="panel stack" onSubmit={add}>
        <div>
          <h3>Mitarbeiter/in hinzufügen</h3>
          <p className="hint">Anmeldung ausschließlich mit dem Microsoft-365-Konto der Kanzlei (z. B. name@stumbaum.info). Mandanten werden anschließend zugeordnet.</p>
        </div>
        <div className="inline-form">
          <label className="field"><span>E-Mail (Microsoft 365)</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@stumbaum.info" required /></label>
          <label className="field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="Vorname Nachname" /></label>
          <button type="submit" className="btn btn-primary" disabled={!email.trim()}>Hinzufügen</button>
        </div>
      </form>

      <div className="panel">
        {!staff ? <p className="hint">Wird geladen …</p> : !staff.length ? <p className="hint">Noch keine Kanzlei-Mitarbeitenden angelegt.</p> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Mitarbeiter/in</th><th>Status</th><th>Mandanten</th><th><span className="sr-only">Aktionen</span></th></tr></thead>
              <tbody>
                {staff.map(member => (
                  <tr key={member.email}>
                    <td><div className="cell-main">{member.name || member.email}</div><div className="muted small">{member.email}</div></td>
                    <td><Badge tone={member.active ? 'green' : 'gray'}>{member.active ? 'Aktiv' : 'Deaktiviert'}</Badge></td>
                    <td>{member.organizations.length ? <span title={member.organizations.map(o => o.name).join(', ')}>{member.organizations.length} · <span className="muted small">{member.organizations.slice(0, 3).map(o => o.name).join(', ')}{member.organizations.length > 3 ? ' …' : ''}</span></span> : <span className="muted">keine</span>}</td>
                    <td className="cell-actions">
                      {confirm === member.email ? (
                        <>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => run(() => api.deleteStaff(member.email))}>Entfernen</button>
                          <button type="button" className="btn btn-sm" onClick={() => setConfirm(null)}>Abbrechen</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="btn btn-sm" onClick={() => setDialog(member)}>Mandanten</button>
                          <button type="button" className="btn btn-sm" onClick={() => run(() => api.saveStaff({ email: member.email, active: !member.active }))}>{member.active ? 'Deaktivieren' : 'Aktivieren'}</button>
                          <button type="button" className="btn btn-sm" onClick={() => setConfirm(member.email)}>Entfernen</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {dialog && <AssignDialog member={dialog} orgs={orgs} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await load(); }} />}
    </div>
  );
}
