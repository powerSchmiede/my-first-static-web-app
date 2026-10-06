import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { Link } from '../router';
import { Modal } from '../Admin';
import { Badge, ErrorText, InviteResult, StatCard, STATUS_TONES } from '../ui';
import OrganizationApps from './AppAccess';
import { AUDIT_LABELS, INVITATION_STATUS_LABELS, ROLE_LABELS, USER_STATUS_LABELS, formatDate } from '../labels';

const TABS = [
  { key: '', label: 'Übersicht' },
  { key: 'benutzer', label: 'Benutzer' },
  { key: 'einladungen', label: 'Einladungen' },
  { key: 'einstellungen', label: 'Einstellungen' },
];

// Nur in der Plattform-Ansicht: App-Freigaben vergibt ausschließlich der Plattform-Admin.
const PLATFORM_TABS = [...TABS.slice(0, 3), { key: 'apps', label: 'Apps' }, TABS[3]];

function InviteDialog({ orgId, onClose, onInvited }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('OrgUser');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await api.inviteUser(orgId, { email: email.trim(), role });
      setResult(response);
      onInvited();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Benutzer einladen" onClose={onClose}>
      {result ? (
        <>
          <InviteResult result={result} />
          <div className="form-actions"><button type="button" className="btn btn-primary" onClick={onClose}>Fertig</button></div>
        </>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <label className="field">
            <span>E-Mail-Adresse</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@firma.de" autoComplete="off" required />
          </label>
          <label className="field">
            <span>Rolle</span>
            <select value={role} onChange={e => setRole(e.target.value)}>
              {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <small>Organization Admins können weitere Benutzer einladen und verwalten.</small>
          </label>
          <ErrorText error={error} />
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Abbrechen</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>{busy ? 'Einladen …' : 'Einladung senden'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ResendDialog({ result, onClose }) {
  return (
    <Modal title="Einladung erneut gesendet" onClose={onClose}>
      <InviteResult result={result} />
      <div className="form-actions"><button type="button" className="btn btn-primary" onClick={onClose}>Fertig</button></div>
    </Modal>
  );
}

function Overview({ org, audit, onInvite, basePath }) {
  const s = org.stats;
  return (
    <div className="stack-lg">
      <div className="stat-grid">
        <StatCard label="Benutzer" value={s.users} hint={`${s.admins} Admin${s.admins === 1 ? '' : 's'}`} />
        <StatCard label="Aktiv" value={s.activeUsers} tone="green" />
        <StatCard label="Deaktiviert" value={s.disabledUsers} tone="gray" />
        <StatCard label="Offene Einladungen" value={s.pendingInvitations} tone="blue" hint={s.expiredInvitations ? `${s.expiredInvitations} abgelaufen` : undefined} />
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>Letzte Aktivitäten</h3>
          <div className="panel-actions">
            <Link className="btn" to={`${basePath}/benutzer`}>Benutzer verwalten</Link>
            <button type="button" className="btn btn-primary" onClick={onInvite}>+ Benutzer einladen</button>
          </div>
        </div>
        <AuditList entries={audit} />
      </div>
    </div>
  );
}

export function AuditList({ entries }) {
  if (!entries) return <p className="hint">Wird geladen …</p>;
  if (!entries.length) return <p className="hint">Noch keine Aktivitäten.</p>;
  return (
    <ul className="audit-list">
      {entries.slice(0, 25).map(entry => (
        <li key={entry.id}>
          <span className="audit-time">{formatDate(entry.timestamp)}</span>
          <span className="audit-action">
            {AUDIT_LABELS[entry.action] || entry.action}
            {entry.details && entry.details.email ? <span className="muted"> · {entry.details.email}</span> : null}
            {entry.details && entry.details.name ? <span className="muted"> · {entry.details.name}</span> : null}
            {entry.details && entry.details.added && entry.details.added.length ? <span className="muted"> · + {entry.details.added.join(', ')}</span> : null}
            {entry.details && entry.details.removed && entry.details.removed.length ? <span className="muted"> · − {entry.details.removed.join(', ')}</span> : null}
          </span>
          <span className="audit-actor muted">{entry.actorEmail || 'System'}</span>
          {entry.result !== 'success' && <Badge tone={STATUS_TONES[entry.result]}>{entry.result === 'denied' ? 'verweigert' : 'fehlgeschlagen'}</Badge>}
        </li>
      ))}
    </ul>
  );
}

function UserRow({ user, isSelf, onChange, onRemove, busy }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <tr>
      <td>
        <div className="cell-main">{user.displayName || '–'}{isSelf && <span className="you">Du</span>}</div>
      </td>
      <td>{user.email}</td>
      <td>
        {isSelf ? ROLE_LABELS[user.role] : (
          <select aria-label={`Rolle von ${user.email}`} value={user.role} disabled={busy} onChange={e => onChange({ role: e.target.value })}>
            {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        )}
      </td>
      <td><Badge tone={STATUS_TONES[user.status]}>{USER_STATUS_LABELS[user.status]}</Badge></td>
      <td>{user.invitedAt ? `Angenommen` : 'Ohne Einladung'}<div className="muted small">{formatDate(user.invitedAt || user.createdAt, false)}</div></td>
      <td>{formatDate(user.lastLoginAt)}</td>
      <td className="cell-actions">
        {isSelf ? <span className="muted small">–</span> : confirm ? (
          <>
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={onRemove}>Entfernen</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirm(false)}>Abbrechen</button>
          </>
        ) : (
          <>
            {user.status === 'Active'
              ? <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onChange({ status: 'Disabled' })}>Deaktivieren</button>
              : <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onChange({ status: 'Active' })}>Aktivieren</button>}
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirm(true)}>Entfernen</button>
          </>
        )}
      </td>
    </tr>
  );
}

function InvitationActions({ invitation, busy, onResend, onRevoke }) {
  if (invitation.status !== 'Pending' && invitation.status !== 'Expired') return <span className="muted small">–</span>;
  return (
    <>
      {invitation.status === 'Pending' && <button type="button" className="btn btn-sm" disabled={busy} onClick={onResend}>Erneut senden</button>}
      {invitation.status === 'Pending' && <button type="button" className="btn btn-sm" disabled={busy} onClick={onRevoke}>Zurückziehen</button>}
      {invitation.status === 'Expired' && <span className="muted small">Neu einladen</span>}
    </>
  );
}

function Users({ users, invitations, me, busyId, onChangeUser, onRemoveUser, onResend, onRevoke, onInvite }) {
  const [filter, setFilter] = useState('all');
  const pending = invitations.filter(i => i.status === 'Pending');
  const rows = [
    ...users.map(u => ({ kind: 'user', status: u.status, item: u })),
    ...pending.map(i => ({ kind: 'invite', status: 'Invited', item: i })),
  ].filter(row => filter === 'all' || row.status === filter);

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="filter-tabs" role="group" aria-label="Filter">
          {[['all', 'Alle'], ['Active', 'Aktiv'], ['Invited', 'Eingeladen'], ['Disabled', 'Deaktiviert']].map(([key, label]) => (
            <button key={key} type="button" className={filter === key ? 'is-active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={onInvite}>+ Benutzer einladen</button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Status</th><th>Einladung</th><th>Letzter Login</th><th><span className="sr-only">Aktionen</span></th></tr>
          </thead>
          <tbody>
            {rows.map(row => row.kind === 'user' ? (
              <UserRow
                key={row.item.id}
                user={row.item}
                isSelf={!!me.membership && me.membership.userId === row.item.id}
                busy={busyId === row.item.id}
                onChange={patch => onChangeUser(row.item, patch)}
                onRemove={() => onRemoveUser(row.item)}
              />
            ) : (
              <tr key={`inv-${row.item.id}`}>
                <td className="muted">Noch nicht angemeldet</td>
                <td>{row.item.email}</td>
                <td>{ROLE_LABELS[row.item.role]}</td>
                <td><Badge tone="blue">Invited</Badge></td>
                <td>Offen<div className="muted small">läuft ab {formatDate(row.item.expiresAt, false)}</div></td>
                <td>–</td>
                <td className="cell-actions">
                  <InvitationActions invitation={row.item} busy={busyId === row.item.id} onResend={() => onResend(row.item)} onRevoke={() => onRevoke(row.item)} />
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="7" className="empty">Keine Einträge.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Invitations({ invitations, busyId, onResend, onRevoke, onInvite }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Einladungen</h3>
        <button type="button" className="btn btn-primary" onClick={onInvite}>+ Benutzer einladen</button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>E-Mail</th><th>Rolle</th><th>Status</th><th>Gesendet</th><th>Gültig bis</th><th>Eingeladen von</th><th><span className="sr-only">Aktionen</span></th></tr>
          </thead>
          <tbody>
            {invitations.map(invitation => (
              <tr key={invitation.id}>
                <td>{invitation.email}</td>
                <td>{ROLE_LABELS[invitation.role]}</td>
                <td><Badge tone={STATUS_TONES[invitation.status]}>{INVITATION_STATUS_LABELS[invitation.status]}</Badge></td>
                <td>{formatDate(invitation.lastSentAt || invitation.createdAt)}{invitation.sentCount > 1 && <div className="muted small">{invitation.sentCount}× gesendet</div>}</td>
                <td>{invitation.status === 'Accepted' ? <span className="muted">angenommen {formatDate(invitation.acceptedAt, false)}</span> : formatDate(invitation.expiresAt, false)}</td>
                <td className="muted">{invitation.invitedBy}</td>
                <td className="cell-actions">
                  <InvitationActions invitation={invitation} busy={busyId === invitation.id} onResend={() => onResend(invitation)} onRevoke={() => onRevoke(invitation)} />
                </td>
              </tr>
            ))}
            {!invitations.length && <tr><td colSpan="7" className="empty">Noch keine Einladungen.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Settings({ org, onRenamed }) {
  const [name, setName] = useState(org.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api.renameOrganization(org.id, name.trim());
      setSaved(true);
      onRenamed();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-grid">
      <form className="panel stack" onSubmit={submit}>
        <h3>Organisation</h3>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={e => { setName(e.target.value); setSaved(false); }} maxLength={100} />
        </label>
        <ErrorText error={error} />
        {saved && <p className="notice notice-success">Gespeichert.</p>}
        <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy || name.trim() === org.name}>Speichern</button></div>
      </form>
      <div className="panel stack">
        <h3>Details</h3>
        <dl className="details">
          <dt>Status</dt><dd><Badge tone={STATUS_TONES[org.status]}>{org.status}</Badge></dd>
          <dt>Erstellt</dt><dd>{formatDate(org.createdAt)}</dd>
          <dt>Organisations-ID</dt><dd className="mono">{org.id}</dd>
        </dl>
        <h3>Rollen</h3>
        <ul className="role-list">
          <li><strong>Organization Admin</strong> – lädt Benutzer ein, verwaltet Rollen und Status.</li>
          <li><strong>Organization User</strong> – nutzt die Apps, keine Benutzerverwaltung.</li>
        </ul>
      </div>
    </div>
  );
}

export default function Organization({ orgId, tab, basePath, me, backLink, platformView }) {
  const [org, setOrg] = useState(null);
  const [users, setUsers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [audit, setAudit] = useState(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    try {
      const [o, u, i, a] = await Promise.all([
        api.getOrganization(orgId),
        api.listUsers(orgId),
        api.listInvitations(orgId),
        api.listAudit(orgId),
      ]);
      setOrg(o);
      setUsers(u.sort((x, y) => (x.displayName || x.email).localeCompare(y.displayName || y.email, 'de')));
      setInvitations(i);
      setAudit(a);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function run(id, action) {
    setBusyId(id);
    setActionError('');
    try {
      const result = await action();
      await load();
      return result;
    } catch (err) {
      setActionError(err.message);
      return null;
    } finally {
      setBusyId(null);
    }
  }

  const handlers = {
    onChangeUser: (user, patch) => run(user.id, () => api.updateUser(orgId, user.id, patch)),
    onRemoveUser: user => run(user.id, () => api.removeUser(orgId, user.id)),
    onResend: async invitation => {
      const result = await run(invitation.id, () => api.resendInvitation(orgId, invitation.id));
      if (result) setDialog({ kind: 'resent', result });
    },
    onRevoke: invitation => run(invitation.id, () => api.revokeInvitation(orgId, invitation.id)),
    onInvite: () => setDialog({ kind: 'invite' }),
  };

  if (error) return <div className="page"><p className="page-error" role="alert">{error}</p></div>;
  if (!org) return <div className="page"><p className="hint">Wird geladen …</p></div>;

  const tabs = platformView ? PLATFORM_TABS : TABS;
  const active = tabs.find(t => t.key === (tab || '')) || tabs[0];

  return (
    <div className="page">
      {backLink}
      <div className="page-head">
        <div>
          <p className="eyebrow">{platformView ? 'Organisation' : 'Meine Organisation'}</p>
          <h1>{org.name}</h1>
        </div>
        {org.status !== 'Active' && <Badge tone="gray">Deaktiviert</Badge>}
      </div>
      <nav className="tabs" aria-label="Organisation">
        {tabs.map(t => (
          <Link key={t.key} to={t.key ? `${basePath}/${t.key}` : basePath} className={t === active ? 'is-active' : ''} aria-current={t === active ? 'page' : undefined}>
            {t.label}
            {t.key === 'einladungen' && org.stats.pendingInvitations > 0 && <span className="tab-count">{org.stats.pendingInvitations}</span>}
          </Link>
        ))}
      </nav>

      <ErrorText error={actionError} />

      {active.key === '' && <Overview org={org} audit={audit} basePath={basePath} onInvite={handlers.onInvite} />}
      {active.key === 'benutzer' && <Users users={users} invitations={invitations} me={me} busyId={busyId} {...handlers} />}
      {active.key === 'einladungen' && <Invitations invitations={invitations} busyId={busyId} {...handlers} />}
      {active.key === 'apps' && <OrganizationApps orgId={orgId} onSaved={load} />}
      {active.key === 'einstellungen' && <Settings org={org} onRenamed={load} />}

      {dialog && dialog.kind === 'invite' && <InviteDialog orgId={orgId} onClose={() => setDialog(null)} onInvited={load} />}
      {dialog && dialog.kind === 'resent' && <ResendDialog result={dialog.result} onClose={() => setDialog(null)} />}
    </div>
  );
}
