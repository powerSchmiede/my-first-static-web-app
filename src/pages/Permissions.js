import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { Badge, ErrorText } from '../ui';
import { ROLE_LABELS } from '../labels';
import { invalidate } from '../cache';

// Rechte der Benutzer einer Organisation: Zeilen = Benutzer, Spalten = Bereiche.
// Jede Änderung wird sofort gespeichert; Rechte prüft und protokolliert der Server.
// Als KanzleiMind-Support ist eine Begründung Pflicht (z. B. Ticketnummer).
export default function Permissions({ orgId, me }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
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

  const selfId = me && me.membership && me.membership.organizationId === orgId ? me.membership.userId : null;

  async function toggle(user, key, granted) {
    if (data.support && reason.trim().length < 3) {
      setError('Bitte zuerst oben eine Begründung für den Support-Eingriff angeben.');
      return;
    }
    const next = granted ? [...user.permissions, key] : user.permissions.filter(p => p !== key);
    setBusy(`${user.id}:${key}`);
    setError('');
    try {
      const result = await api.setUserPermissions(orgId, user.id, next, data.support ? reason.trim() : undefined);
      setData(current => ({ ...current, users: current.users.map(u => (u.id === user.id ? { ...u, permissions: result.permissions } : u)) }));
      invalidate(`org:${orgId}`);
      // Eigene Rechte geändert: Navigation (Rail) neu laden
      if (user.id === selfId) window.dispatchEvent(new Event('km:refresh-me'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  if (!data) return <div className="panel">{error ? <ErrorText error={error} /> : <p className="hint">Wird geladen …</p>}</div>;

  const licensed = data.catalog.filter(p => p.licensed);
  const users = [...data.users].sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email, 'de'));
  return (
    <div className="stack-lg">
      {data.support && (
        <div className="panel stack support-panel">
          <div>
            <h3>Support-Zugriff</h3>
            <p className="hint">Du änderst Rechte einer fremden Organisation. Jede Änderung erscheint im Protokoll der Organisation als „KanzleiMind-Support“ mit dieser Begründung.</p>
          </div>
          <label className="field">
            <span>Begründung (Pflicht)</span>
            <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder="z. B. Ticket #1234 – Lohnzugang für neue Mitarbeiterin" />
          </label>
        </div>
      )}

      <div className="panel stack">
        <div>
          <h3>Rechte der Benutzer</h3>
          <p className="hint">Lege fest, wer welchen Bereich öffnen darf. Auch Organization Admins brauchen das jeweilige Recht. Rechte aus Gruppen sind mit „über …“ gekennzeichnet und werden im Reiter „Gruppen“ verwaltet. Änderungen werden sofort gespeichert und protokolliert.</p>
        </div>
        <ErrorText error={error} />
        {!licensed.length ? (
          <p className="hint">Für eure Organisation sind noch keine Bereiche freigeschaltet. Wende dich an KanzleiMind.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table permission-table">
              <thead>
                <tr>
                  <th>Benutzer</th>
                  {licensed.map(p => <th key={p.key} title={p.description}>{p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id} className={user.status !== 'Active' ? 'is-muted' : ''}>
                    <td>
                      <div className="cell-main">{user.displayName || user.email}{user.id === selfId && <span className="you">Du</span>}</div>
                      <div className="muted small">{ROLE_LABELS[user.role]}{user.status !== 'Active' && ' · deaktiviert'}</div>
                    </td>
                    {licensed.map(p => {
                      const granted = user.permissions.includes(p.key);
                      const viaGroups = (data.groups || []).filter(g => user.groups.includes(g.id) && g.permissions.includes(p.key)).map(g => g.name);
                      return (
                        <td key={p.key} className="cell-switch">
                          <label className="switch" title={`${p.label} für ${user.email}`}>
                            <input type="checkbox" checked={granted} disabled={busy === `${user.id}:${p.key}`} onChange={e => toggle(user, p.key, e.target.checked)} aria-label={`${p.label} für ${user.email}`} />
                            <span className="switch-track" aria-hidden="true" />
                          </label>
                          {viaGroups.length > 0 && <div className="via-group" title="Recht aus Gruppe">über {viaGroups.join(', ')}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.catalog.some(p => !p.licensed) && (
          <p className="hint">
            Nicht freigeschaltet: {data.catalog.filter(p => !p.licensed).map(p => p.label).join(', ')}.{' '}
            <Badge tone="gray">auf Anfrage</Badge>
          </p>
        )}
      </div>
    </div>
  );
}
