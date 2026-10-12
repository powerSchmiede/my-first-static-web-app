import React, { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { Badge, ErrorText } from '../ui';
import { ROLE_LABELS } from '../labels';
import { LOGOUT_URL } from '../api';

const CONTACT = [
  { key: 'firstName', label: 'Vorname' },
  { key: 'lastName', label: 'Nachname' },
  { key: 'phone', label: 'Telefon', type: 'tel' },
  { key: 'mobile', label: 'Mobil', type: 'tel' },
];

// Lohndaten in Abschnitten, Feldnamen wie im Server (profiles.js)
const PAYROLL_SECTIONS = [
  { title: 'Persönlich', fields: [
    { key: 'birthDate', label: 'Geburtsdatum', type: 'date' },
    { key: 'street', label: 'Straße und Hausnummer', wide: true },
    { key: 'zip', label: 'PLZ', inputMode: 'numeric' },
    { key: 'city', label: 'Ort' },
  ] },
  { title: 'Beschäftigung', fields: [
    { key: 'personnelNumber', label: 'Personalnummer' },
    { key: 'entryDate', label: 'Eintrittsdatum', type: 'date' },
    { key: 'weeklyHours', label: 'Wochenstunden', inputMode: 'decimal' },
  ] },
  { title: 'Steuer', fields: [
    { key: 'taxId', label: 'Steuer-ID', inputMode: 'numeric', secret: true },
    { key: 'taxClass', label: 'Steuerklasse', options: [['', '–'], ['1', 'I'], ['2', 'II'], ['3', 'III'], ['4', 'IV'], ['5', 'V'], ['6', 'VI']] },
    { key: 'childAllowance', label: 'Kinderfreibeträge', inputMode: 'decimal' },
    { key: 'denomination', label: 'Konfession (Kirchensteuer)', options: [['', '–'], ['keine', 'keine'], ['ev', 'evangelisch'], ['rk', 'römisch-katholisch'], ['sonstige', 'sonstige']] },
  ] },
  { title: 'Sozialversicherung', fields: [
    { key: 'socialSecurityNumber', label: 'SV-Nummer', secret: true },
    { key: 'healthInsurance', label: 'Krankenkasse' },
  ] },
  { title: 'Bank', fields: [
    { key: 'iban', label: 'IBAN', wide: true, secret: true },
  ] },
];

function mask(value) {
  if (!value) return '–';
  return value.length <= 4 ? '••••' : `${'•'.repeat(Math.min(value.length - 4, 12))} ${value.slice(-4)}`;
}

function Field({ field, value, onChange, editing, reveal }) {
  if (!editing) {
    let shown = value || '–';
    if (field.options) shown = (field.options.find(([k]) => k === value) || ['', '–'])[1];
    if (field.type === 'date' && value) shown = new Date(`${value}T00:00:00`).toLocaleDateString('de-DE');
    if (field.secret && value && !reveal) shown = mask(value);
    return (
      <div className={`profile-field ${field.wide ? 'is-wide' : ''}`}>
        <span>{field.label}</span>
        <strong>{shown}</strong>
      </div>
    );
  }
  return (
    <label className={`field profile-field ${field.wide ? 'is-wide' : ''}`}>
      <span>{field.label}</span>
      {field.options ? (
        <select value={value || ''} onChange={e => onChange(e.target.value)}>
          {field.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      ) : (
        <input type={field.type || 'text'} inputMode={field.inputMode} value={value || ''} onChange={e => onChange(e.target.value)} autoComplete="off" />
      )}
    </label>
  );
}

function Section({ title, fields, data, canEdit, onSave, hint, reveal }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (!editing) setDraft(data); }, [data, editing]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const changed = Object.fromEntries(fields.map(f => [f.key, draft[f.key] || '']));
      await onSave(changed);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="profile-section" onSubmit={save}>
      <div className="profile-section-head">
        <h4>{title}</h4>
        {canEdit && !editing && <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>Bearbeiten</button>}
      </div>
      {hint && <p className="hint">{hint}</p>}
      <div className="profile-grid">
        {fields.map(f => (
          <Field key={f.key} field={f} value={draft[f.key]} editing={editing} reveal={reveal} onChange={v => setDraft(d => ({ ...d, [f.key]: v }))} />
        ))}
      </div>
      <ErrorText error={error} />
      {editing && (
        <div className="form-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>Abbrechen</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Speichern …' : 'Speichern'}</button>
        </div>
      )}
    </form>
  );
}

// Profilansicht: eigenes Profil (orgId/userId leer) oder Profil eines Benutzers der eigenen
// Organisation (Org-Admin: Kontaktdaten; Recht "Lohn": auch Lohndaten). Rechte prüft der Server.
export default function Profile({ orgId, userId, backLink }) {
  const own = !userId;
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [reveal, setReveal] = useState(false);

  const load = useCallback(async () => {
    try {
      setProfile(own ? await api.fetchMyProfile() : await api.fetchUserProfile(orgId, userId));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [own, orgId, userId]);

  useEffect(() => { load(); }, [load]);

  async function save(section, values) {
    const body = { [section]: values };
    setProfile(own ? await api.saveMyProfile(body) : await api.saveUserProfile(orgId, userId, body));
  }

  if (error && !profile) return <div className="page page-narrow"><p className="page-error" role="alert">{error}</p></div>;
  if (!profile) return <div className="page"><p className="hint">Wird geladen …</p></div>;

  const { user, contact, payroll } = profile;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || user.displayName || user.email;

  return (
    <div className="page profile-page">
      {backLink}
      <div className="page-head">
        <div className="profile-identity">
          <span className="avatar avatar-lg" aria-hidden="true">{(contact.firstName || user.email)[0].toUpperCase()}{(contact.lastName || '')[0] || ''}</span>
          <div>
            <p className="eyebrow">{own ? 'Mein Profil' : 'Benutzerprofil'}</p>
            <h1>{name}</h1>
            <p className="hint">{user.email} · {ROLE_LABELS[user.role]} · {user.organizationName}</p>
          </div>
        </div>
        {own && <a className="btn" href={LOGOUT_URL}>Abmelden</a>}
      </div>

      <div className="profile-columns">
        <div className="stack-lg">
          <div className="panel stack">
            <h3>{own ? 'Meine Gruppen' : 'Gruppen'}</h3>
            {profile.groups.length ? (
              <div className="chip-row">{profile.groups.map(g => <Badge key={g.id} tone="blue">{g.name}</Badge>)}</div>
            ) : <p className="hint">Keiner Gruppe zugeordnet.</p>}
          </div>
          <div className="panel stack">
            <h3>{own ? 'Meine Rechte' : 'Rechte'}</h3>
            {profile.permissions.length ? (
              <ul className="rights-list">
                {profile.permissions.map(p => (
                  <li key={p.key}><strong>{p.label}</strong><span className="muted small">{p.sources.join(', ')}</span></li>
                ))}
              </ul>
            ) : <p className="hint">Noch keine Bereiche freigegeben. Wende dich an den Administrator deiner Organisation.</p>}
          </div>
        </div>

        <div className="stack-lg">
          <div className="panel">
            <Section title="Kontaktdaten" fields={CONTACT} data={contact} canEdit={profile.canEdit.contact} onSave={values => save('contact', values)} />
          </div>

          <div className="panel stack">
            <div className="panel-head">
              <div>
                <h3>Lohnrelevante Daten</h3>
                <p className="hint">Verschlüsselt gespeichert. Einsehbar nur für {own ? 'dich' : 'die Person'} und die Lohnbuchhaltung (Recht „Lohn“).</p>
              </div>
              {payroll && <button type="button" className="btn btn-sm" onClick={() => setReveal(r => !r)}>{reveal ? 'Verbergen' : 'Vollständig anzeigen'}</button>}
            </div>
            {!profile.canViewPayroll ? (
              <p className="notice notice-warn">Lohndaten siehst du nur mit dem Recht „Lohn“.</p>
            ) : !profile.payrollConfigured ? (
              <p className="notice notice-warn">Die Verschlüsselung für Lohndaten ist noch nicht eingerichtet. Bitte wende dich an KanzleiMind.</p>
            ) : PAYROLL_SECTIONS.map(section => (
              <Section key={section.title} title={section.title} fields={section.fields} data={payroll} canEdit={profile.canEdit.payroll} reveal={reveal} onSave={values => save('payroll', values)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
