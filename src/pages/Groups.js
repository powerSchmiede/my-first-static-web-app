import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { Modal } from '../Admin';
import { Badge, ErrorText } from '../ui';
import { invalidate } from '../cache';

// Gruppen einer Organisation (z. B. Lohn, FiBu, IT, HR). Gruppen können Bereichsrechte
// tragen; Mitglieder erben sie. Daten kommen aus der Rechte-Übersicht (Katalog, Benutzer, Gruppen).
function GroupDialog({ orgId, group, data, reason, onClose, onSaved }) {
  const editing = !!group;
  const [name, setName] = useState(editing ? group.name : '');
  const [rights, setRights] = useState(new Set(editing ? group.permissions : []));
  const [memberIds, setMemberIds] = useState(new Set(editing ? data.users.filter(u => u.groups.includes(group.id)).map(u => u.id) : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const licensed = data.catalog.filter(p => p.licensed || rights.has(p.key));

  function toggle(set, setter, key) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const extra = reason ? { reason } : {};
    try {
      const saved = editing
        ? await api.updateGroup(orgId, group.id, { name: name.trim(), permissions: [...rights], ...extra })
        : await api.createGroup(orgId, { name: name.trim(), permissions: [...rights], ...extra });
      // Mitglieder: nur Benutzer ändern, deren Zugehörigkeit sich tatsächlich ändert.
      for (const user of data.users) {
        const wasMember = user.groups.includes(saved.id);
        const isMember = memberIds.has(user.id);
        if (wasMember === isMember) continue;
        const next = isMember ? [...user.groups, saved.id] : user.groups.filter(id => id !== saved.id);
        await api.setUserGroups(orgId, user.id, next, reason || undefined);
      }
      invalidate(`org:${orgId}`);
      window.dispatchEvent(new Event('km:refresh-me'));
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const users = [...data.users].sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email, 'de'));

  return (
    <Modal title={editing ? `Gruppe „${group.name}“ bearbeiten` : 'Neue Gruppe'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="z. B. Lohn, FiBu, IT, HR, Marketing" required />
        </label>
        <fieldset className="field">
          <legend>Rechte der Gruppe</legend>
          <p className="hint">Alle Mitglieder erhalten diese Bereiche zusätzlich zu ihren eigenen Rechten.</p>
          {licensed.length ? (
            <div className="check-grid">
              {licensed.map(p => (
                <label key={p.key} className={`app-check ${rights.has(p.key) ? 'is-selected' : ''}`}>
                  <input type="checkbox" checked={rights.has(p.key)} onChange={() => toggle(rights, setRights, p.key)} />
                  <span className="app-check-title">{p.label}{!p.licensed && <span className="muted small"> · nicht freigeschaltet</span>}</span>
                </label>
              ))}
            </div>
          ) : <p className="hint">Für eure Organisation sind noch keine Bereiche freigeschaltet.</p>}
        </fieldset>
        <fieldset className="field">
          <legend>Mitglieder ({memberIds.size})</legend>
          <div className="check-grid member-grid">
            {users.map(u => (
              <label key={u.id} className={`app-check ${memberIds.has(u.id) ? 'is-selected' : ''}`}>
                <input type="checkbox" checked={memberIds.has(u.id)} onChange={() => toggle(memberIds, setMemberIds, u.id)} />
                <span className="app-check-title">{u.displayName || u.email}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorText error={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Speichern …' : editing ? 'Speichern' : 'Gruppe anlegen'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Groups({ orgId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { group } | {}
  const [confirmId, setConfirmId] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.getPermissions(orgId));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  function needsReason() {
    if (data.support && reason.trim().length < 3) {
      setError('Bitte zuerst oben eine Begründung für den Support-Eingriff angeben.');
      return true;
    }
    return false;
  }

  async function remove(group) {
    if (needsReason()) return;
    try {
      await api.deleteGroup(orgId, group.id, data.support ? reason.trim() : undefined);
      setConfirmId(null);
      invalidate(`org:${orgId}`);
      window.dispatchEvent(new Event('km:refresh-me'));
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!data) return <div className="panel">{error ? <ErrorText error={error} /> : <p className="hint">Wird geladen …</p>}</div>;

  const label = key => (data.catalog.find(p => p.key === key) || { label: key }).label;

  return (
    <div className="stack-lg">
      {data.support && (
        <div className="panel stack support-panel">
          <div>
            <h3>Support-Zugriff</h3>
            <p className="hint">Änderungen an Gruppen erscheinen im Protokoll der Organisation als „KanzleiMind-Support“ mit dieser Begründung.</p>
          </div>
          <label className="field">
            <span>Begründung (Pflicht)</span>
            <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder="z. B. Ticket #1234" />
          </label>
        </div>
      )}
      <div className="panel stack">
        <div className="panel-head">
          <div>
            <h3>Gruppen</h3>
            <p className="hint">Ordne Mitarbeitende Abteilungen oder Teams zu. Rechte einer Gruppe gelten für alle Mitglieder – neue Kolleginnen und Kollegen müssen nur der Gruppe hinzugefügt werden.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => { if (!needsReason()) setDialog({}); }}>+ Neue Gruppe</button>
        </div>
        <ErrorText error={error} />
        {!data.groups.length ? <p className="hint">Noch keine Gruppen angelegt.</p> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Gruppe</th><th>Rechte</th><th>Mitglieder</th><th><span className="sr-only">Aktionen</span></th></tr></thead>
              <tbody>
                {data.groups.map(group => {
                  const members = data.users.filter(u => u.groups.includes(group.id));
                  return (
                    <tr key={group.id}>
                      <td><div className="cell-main">{group.name}</div></td>
                      <td>{group.permissions.length ? <div className="chip-row">{group.permissions.map(p => <Badge key={p} tone="blue">{label(p)}</Badge>)}</div> : <span className="muted">–</span>}</td>
                      <td>{members.length ? <span title={members.map(u => u.email).join(', ')}>{members.length} · <span className="muted small">{members.slice(0, 3).map(u => u.displayName || u.email).join(', ')}{members.length > 3 ? ' …' : ''}</span></span> : <span className="muted">keine</span>}</td>
                      <td className="cell-actions">
                        {confirmId === group.id ? (
                          <>
                            <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(group)}>Löschen</button>
                            <button type="button" className="btn btn-sm" onClick={() => setConfirmId(null)}>Abbrechen</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn btn-sm" onClick={() => { if (!needsReason()) setDialog({ group }); }}>Bearbeiten</button>
                            <button type="button" className="btn btn-sm" onClick={() => setConfirmId(group.id)}>Löschen</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {dialog && (
        <GroupDialog orgId={orgId} group={dialog.group} data={data} reason={data.support ? reason.trim() : ''} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await load(); }} />
      )}
    </div>
  );
}
