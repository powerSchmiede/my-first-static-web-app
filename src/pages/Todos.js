import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { Link } from '../router';
import { Badge, ErrorText } from '../ui';
import { formatDate } from '../labels';

const KIND_LABELS = {
  approval: { label: 'Freigabe', tone: 'blue' },
  implementation: { label: 'Umsetzung', tone: 'amber' },
  info: { label: 'Info', tone: 'gray' },
  general: { label: 'Aufgabe', tone: 'gray' },
};

const ASSIGNEE = todo => ({ admins: 'Organization Admins', group: 'Gruppe', user: 'Persönlich', kanzlei: 'Kanzlei' }[todo.assignee.type]);

// To-dos (Grundfunktion für alle): eigene, die der eigenen Gruppen und – für Kanzlei-
// Mitarbeitende – die Aufgaben ihrer Mandanten. Welche To-dos sichtbar sind, prüft der Server.
export default function Todos({ showOrganization }) {
  const [todos, setTodos] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('open');

  const load = useCallback(async () => {
    try {
      setTodos(await api.fetchTodos());
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function done(todo) {
    try {
      await api.completeTodo(todo.organizationId, todo.id);
      window.dispatchEvent(new Event('km:refresh-me'));
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const shown = (todos || []).filter(t => filter === 'all' || t.status === filter);
  const openCount = (todos || []).filter(t => t.status === 'open').length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Aufgaben</p>
          <h1>To-dos</h1>
        </div>
        <div className="filter-tabs" role="group" aria-label="Filter">
          {[['open', `Offen (${openCount})`], ['done', 'Erledigt'], ['all', 'Alle']].map(([key, label]) => (
            <button key={key} type="button" className={filter === key ? 'is-active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>
      </div>
      <ErrorText error={error} />
      {!todos ? <p className="hint">Wird geladen …</p> : !shown.length ? (
        <div className="panel"><p className="hint">{filter === 'open' ? 'Keine offenen To-dos. 🎉' : 'Keine Einträge.'}</p></div>
      ) : (
        <ul className="todo-list">
          {shown.map(todo => {
            const kind = KIND_LABELS[todo.kind] || KIND_LABELS.general;
            const link = todo.requestId ? `/antrag/${encodeURIComponent(todo.organizationId)}/${encodeURIComponent(todo.requestId)}` : null;
            return (
              <li key={`${todo.organizationId}-${todo.id}`} className={`todo-item panel ${todo.status === 'done' ? 'is-done' : ''}`}>
                <div className="todo-main">
                  <div className="todo-meta">
                    <Badge tone={kind.tone}>{kind.label}</Badge>
                    {showOrganization && <span className="muted small">{todo.organizationName}</span>}
                    <span className="muted small">{ASSIGNEE(todo)} · {formatDate(todo.createdAt)}</span>
                  </div>
                  <strong>{link ? <Link to={link} className="cell-link">{todo.title}</Link> : todo.title}</strong>
                  {todo.description && <p className="hint">{todo.description}</p>}
                  {todo.status === 'done' && <span className="muted small">Erledigt {formatDate(todo.completedAt)} · {todo.completedBy}</span>}
                </div>
                <div className="todo-actions">
                  {link && todo.status === 'open' && <Link className="btn btn-primary btn-sm" to={link}>{todo.kind === 'approval' ? 'Prüfen' : todo.kind === 'implementation' ? 'Umsetzen' : 'Öffnen'}</Link>}
                  {todo.status === 'open' && (todo.kind === 'info' || todo.kind === 'general') && <button type="button" className="btn btn-sm" onClick={() => done(todo)}>Erledigt</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
