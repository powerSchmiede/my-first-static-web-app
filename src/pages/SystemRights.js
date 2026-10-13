import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { Link } from '../router';
import { Modal } from '../Admin';
import { Badge, ErrorText } from '../ui';
import { formatDate, absoluteLink } from '../labels';

export const REQUEST_STATUS = {
  pending: { label: 'Wartet auf Freigabe', tone: 'blue' },
  approved: { label: 'Freigegeben – Umsetzung offen', tone: 'amber' },
  implemented: { label: 'Umgesetzt', tone: 'green' },
  rejected: { label: 'Abgelehnt', tone: 'red' },
  cancelled: { label: 'Abgebrochen', tone: 'gray' },
};

// Rechte-Baum (Bereich → Recht). Optional mit Vergleichsspalten (bisher / Vorschlag).
export function RightsTree({ catalog, selected, onToggle, compare, readOnly }) {
  return (
    <div className="rights-tree">
      {catalog.areas.map(area => (
        <fieldset key={area.key} className="rights-area">
          <legend>{area.title}</legend>
          {area.rights.map(right => {
            const checked = selected.has(right.key);
            const before = compare && compare.current.includes(right.key);
            const proposed = compare && compare.proposed && compare.proposed.includes(right.key);
            const changed = compare && checked !== before;
            return (
              <label key={right.key} className={`rights-item ${checked ? 'is-checked' : ''} ${changed ? 'is-changed' : ''}`}>
                <input type="checkbox" checked={checked} disabled={readOnly} onChange={() => onToggle && onToggle(right.key)} />
                <span className="rights-item-text">
                  <strong>{right.title}</strong>
                  <span>{right.description}</span>
                </span>
                {compare && (
                  <span className="rights-flags">
                    {before && <Badge tone="gray">bisher</Badge>}
                    {compare.proposed && proposed && !readOnly && !checked && <Badge tone="amber">vorgeschlagen</Badge>}
                    {changed && <Badge tone={checked ? 'green' : 'red'}>{checked ? 'neu' : 'entfällt'}</Badge>}
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

function toggleIn(set, key) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

// Kanzlei: Rechte für einen Benutzer vorbefüllen -> Antrag an den Mandanten
function RequestDialog({ orgId, user, catalog, onClose, onCreated }) {
  const [selected, setSelected] = useState(new Set(user.rights));
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setResult(await api.createRightsRequest(orgId, { userId: user.id, system: 'datev', rights: [...selected], comment }));
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const link = absoluteLink(result.link);
    return (
      <Modal title="Antrag gesendet" onClose={onClose}>
        <div className="stack">
          <p className="notice notice-success">Die zuständige Stelle beim Mandanten hat ein To-do erhalten.</p>
          {!result.emailSent && (
            <p className="notice notice-warn">E-Mail-Versand ist noch nicht eingerichtet – das To-do ist in der App sichtbar. Bei Bedarf den Link selbst weitergeben.</p>
          )}
          <div className="copy-row">
            <input readOnly value={link} onFocus={e => e.target.select()} />
            <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* ignorieren */ } }}>{copied ? 'Kopiert ✓' : 'Link kopieren'}</button>
          </div>
          <div className="form-actions"><button type="button" className="btn btn-primary" onClick={onClose}>Fertig</button></div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`DATEV-Rechte vorbefüllen: ${user.displayName || user.email}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="hint">Vorausgewählt ist der aktuell dokumentierte Stand. Änderungen werden markiert und dem Mandanten zur Freigabe vorgelegt.</p>
        <RightsTree catalog={catalog} selected={selected} onToggle={key => setSelected(s => toggleIn(s, key))} compare={{ current: user.rights }} />
        <label className="field">
          <span>Hinweis an den Mandanten (optional)</span>
          <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} rows={3} placeholder="z. B. Neue Lohnsachbearbeiterin ab 01.11." />
        </label>
        <ErrorText error={error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Senden …' : 'Zur Freigabe senden'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ApproverSetting({ orgId, data, onSaved }) {
  const [value, setValue] = useState(data.approver.type === 'group' ? data.approver.groupId : 'admins');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = data.approver.type === 'group' ? data.approver.groupId : 'admins';

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.setRightsApprover(orgId, value === 'admins' ? { type: 'admins' } : { type: 'group', groupId: value });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="approver-setting">
      <label className="field">
        <span>Zuständig für Freigaben</span>
        <select value={value} onChange={e => setValue(e.target.value)} disabled={!data.canConfigure || busy}>
          <option value="admins">Organization Admins</option>
          {data.groups.map(g => <option key={g.id} value={g.id}>Gruppe {g.name}</option>)}
        </select>
      </label>
      {data.canConfigure && value !== current && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>Speichern</button>}
      <ErrorText error={error} />
    </div>
  );
}

// Übersicht der DATEV-Rechte eines Mandanten. Für die Kanzlei mit "Vorbefüllen",
// für Org-Admins mit der Einstellung, wer Freigaben erteilt.
export default function SystemRightsOverview({ orgId, title, backLink }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getRightsOverview(orgId));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="panel">{error ? <ErrorText error={error} /> : <p className="hint">Wird geladen …</p>}</div>;

  const openFor = userId => data.requests.find(r => r.targetUserId === userId && ['pending', 'approved'].includes(r.status));
  const total = data.catalog.areas.reduce((n, a) => n + a.rights.length, 0);
  const users = [...data.users].filter(u => u.status === 'Active').sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email, 'de'));

  return (
    <div className="stack-lg">
      {title}
      {backLink}
      <div className="panel stack">
        <div className="panel-head">
          <div>
            <h3>DATEV-Rechte</h3>
            <p className="hint">
              {data.canRequest
                ? 'Fülle Rechte für Benutzer vor. Der Mandant prüft und gibt frei; danach setzt die Kanzlei sie in DATEV um.'
                : 'Die Kanzlei schlägt DATEV-Rechte vor, die zuständige Person oder Gruppe gibt sie frei. Hier siehst du den dokumentierten Stand.'}
            </p>
          </div>
          <ApproverSetting orgId={orgId} data={data} onSaved={load} />
        </div>
        <ErrorText error={error} />
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Benutzer</th><th>Gruppen</th><th>DATEV-Rechte</th><th>Antrag</th><th><span className="sr-only">Aktionen</span></th></tr></thead>
            <tbody>
              {users.map(user => {
                const open = openFor(user.id);
                return (
                  <tr key={user.id}>
                    <td><div className="cell-main">{user.displayName || user.email}</div><div className="muted small">{user.email}</div></td>
                    <td>{user.groups.length ? user.groups.join(', ') : <span className="muted">–</span>}</td>
                    <td>{user.rights.length} von {total}{user.rightsUpdatedAt && <div className="muted small">Stand {formatDate(user.rightsUpdatedAt, false)}</div>}</td>
                    <td>{open ? <Link to={`/antrag/${encodeURIComponent(orgId)}/${encodeURIComponent(open.id)}`}><Badge tone={REQUEST_STATUS[open.status].tone}>{REQUEST_STATUS[open.status].label}</Badge></Link> : <span className="muted">–</span>}</td>
                    <td className="cell-actions">
                      {data.canRequest && !open && <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog({ user })}>Rechte vorbefüllen</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel stack">
        <h3>Anträge</h3>
        {!data.requests.length ? <p className="hint">Noch keine Anträge.</p> : (
          <ul className="request-list">
            {data.requests.slice(0, 30).map(r => (
              <li key={r.id}>
                <Link to={`/antrag/${encodeURIComponent(orgId)}/${encodeURIComponent(r.id)}`} className="cell-link">{r.targetName || r.targetEmail}</Link>
                <span className="muted small">{formatDate(r.createdAt)} · {r.createdBy}</span>
                <Badge tone={REQUEST_STATUS[r.status].tone}>{REQUEST_STATUS[r.status].label}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dialog && <RequestDialog orgId={orgId} user={dialog.user} catalog={data.catalog} onClose={() => setDialog(null)} onCreated={load} />}
    </div>
  );
}
