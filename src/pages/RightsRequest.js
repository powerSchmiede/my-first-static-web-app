import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { Link } from '../router';
import { Badge, ErrorText } from '../ui';
import { formatDate } from '../labels';
import { RightsTree, REQUEST_STATUS } from './SystemRights';

// Antrag auf DATEV-Rechte: Mandant prüft und gibt frei, Kanzlei bestätigt die Umsetzung.
// Welche Aktionen möglich sind, entscheidet der Server (canDecide / canImplement).
export default function RightsRequest({ orgId, requestId }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api.getRightsRequest(orgId, requestId);
      setData(result);
      const r = result.request;
      setSelected(new Set(r.status === 'pending' ? r.proposed : r.status === 'rejected' ? r.proposed : r.approved));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [orgId, requestId]);

  useEffect(() => { load(); }, [load]);

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      await action();
      setComment('');
      window.dispatchEvent(new Event('km:refresh-me'));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="page page-narrow">{error ? <p className="page-error" role="alert">{error}</p> : <p className="hint">Wird geladen …</p>}</div>;

  const r = data.request;
  const status = REQUEST_STATUS[r.status];
  const toggle = key => setSelected(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="page">
      <Link to="/todos" className="back-link">← To-dos</Link>
      <div className="page-head">
        <div>
          <p className="eyebrow">DATEV-Rechte · {data.organizationName}</p>
          <h1>{r.targetName && r.targetName !== r.targetEmail ? r.targetName : r.targetEmail}</h1>
          <p className="hint">{r.targetEmail}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="request-columns">
        <div className="panel stack">
          {data.canDecide ? (
            <>
              <h3>Prüfen und freigeben</h3>
              <p className="hint">Die Kanzlei hat folgende Rechte vorgeschlagen. Du kannst Häkchen anpassen, bevor du freigibst.</p>
            </>
          ) : <h3>{r.status === 'pending' ? 'Vorgeschlagene Rechte' : r.status === 'rejected' ? 'Vorgeschlagene Rechte (abgelehnt)' : 'Freigegebene Rechte'}</h3>}
          <RightsTree catalog={data.catalog} selected={selected} onToggle={toggle} readOnly={!data.canDecide} compare={{ current: r.current, proposed: r.proposed }} />
        </div>

        <div className="stack-lg">
          <div className="panel stack">
            <h3>Verlauf</h3>
            <ol className="timeline">
              <li><strong>Vorbefüllt</strong><span>{formatDate(r.createdAt)} · {r.createdBy}</span>{r.comment && <em>„{r.comment}“</em>}</li>
              <li className={r.decidedAt ? '' : 'is-open'}>
                <strong>{r.status === 'rejected' ? 'Abgelehnt' : r.decidedAt ? 'Freigegeben' : 'Freigabe offen'}</strong>
                <span>{r.decidedAt ? `${formatDate(r.decidedAt)} · ${r.decidedBy}` : `Zuständig: ${r.approverName}`}</span>
                {r.decisionComment && <em>„{r.decisionComment}“</em>}
              </li>
              {r.status !== 'rejected' && r.status !== 'cancelled' && (
                <li className={r.implementedAt ? '' : 'is-open'}>
                  <strong>{r.implementedAt ? 'In DATEV umgesetzt' : 'Umsetzung durch die Kanzlei'}</strong>
                  <span>{r.implementedAt ? `${formatDate(r.implementedAt)} · ${r.implementedBy}` : 'offen'}</span>
                </li>
              )}
            </ol>
          </div>

          {(data.canDecide || data.canImplement) && (
            <div className="panel stack">
              <h3>{data.canDecide ? 'Entscheidung' : 'Umsetzung'}</h3>
              <label className="field">
                <span>{data.canDecide ? 'Kommentar (bei Ablehnung Pflicht)' : 'Kommentar (optional)'}</span>
                <textarea rows={3} value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} />
              </label>
              <ErrorText error={error} />
              <div className="form-actions">
                {data.canDecide ? (
                  <>
                    <button type="button" className="btn btn-danger-outline" disabled={busy} onClick={() => run(() => api.decideRightsRequest(orgId, requestId, { decision: 'reject', comment }))}>Ablehnen</button>
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => api.decideRightsRequest(orgId, requestId, { decision: 'approve', rights: [...selected], comment }))}>{busy ? 'Speichern …' : `Freigeben (${selected.size})`}</button>
                  </>
                ) : (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => api.implementRightsRequest(orgId, requestId, { comment }))}>In DATEV umgesetzt</button>
                )}
              </div>
            </div>
          )}
          {!data.canDecide && !data.canImplement && error && <ErrorText error={error} />}
        </div>
      </div>
    </div>
  );
}
