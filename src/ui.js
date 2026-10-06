import React, { useState } from 'react';
import { absoluteLink } from './labels';

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export const STATUS_TONES = {
  Active: 'green',
  Disabled: 'gray',
  Invited: 'blue',
  Pending: 'blue',
  Accepted: 'green',
  Revoked: 'gray',
  Expired: 'amber',
  success: 'green',
  denied: 'red',
  failed: 'amber',
};

export function ErrorText({ error }) {
  if (!error) return null;
  return <p className="form-error" role="alert">{error}</p>;
}

// Zeigt den Einladungslink nach dem Einladen oder erneuten Senden.
export function InviteResult({ result }) {
  const [copied, setCopied] = useState(false);
  const link = absoluteLink(result.inviteLink);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="invite-result">
      {result.emailSent ? (
        <p className="notice notice-success">Die Einladung wurde per E-Mail an <strong>{result.invitation.email}</strong> gesendet.</p>
      ) : (
        <p className="notice notice-warn">
          Die E-Mail konnte nicht automatisch versendet werden{result.emailStatus === 'not_configured' ? ' (E-Mail-Versand ist noch nicht eingerichtet)' : ''}.
          Schicke den Link bitte selbst an <strong>{result.invitation.email}</strong>.
        </p>
      )}
      <label className="field">
        <span>Einladungslink (7 Tage gültig, nur für diese E-Mail-Adresse)</span>
        <div className="copy-row">
          <input readOnly value={link} onFocus={e => e.target.select()} />
          <button type="button" className="btn" onClick={copy}>{copied ? 'Kopiert ✓' : 'Link kopieren'}</button>
        </div>
      </label>
    </div>
  );
}

export function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export function StatCard({ label, value, tone = 'neutral', hint }) {
  return (
    <div className={`stat-card stat-${tone}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}
