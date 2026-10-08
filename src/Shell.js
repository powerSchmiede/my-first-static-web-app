import React, { useEffect, useRef, useState } from 'react';
import { Link } from './router';
import { LOGOUT_URL } from './api';

const ICONS = {
  apps: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  todos: 'M9 6h11 M9 12h11 M9 18h11 M4 5.5l1 1 2-2 M4 11.5l1 1 2-2 M4 17.5l1 1 2-2',
  fibu: 'M5 3h14v18H5z M8 7h8 M8 11h2 M12 11h2 M16 11v6 M8 14h2 M12 14h2 M8 17h2 M12 17h2',
  lohn: 'M3 7h18v12H3z M3 11h18 M7 15h3 M16 4H6',
  dokumente: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  org: 'M3 21h18 M5 21V7l7-4 7 4v14 M9 21v-4h6v4 M9 10h.01 M15 10h.01 M9 14h.01 M15 14h.01',
  platform: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z M9 12l2 2 4-4',
};

function NavIcon({ name }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function LogoMark({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 192 192" aria-hidden="true">
      <rect width="192" height="192" rx="40" fill="#5E6AD2" />
      <circle cx="96" cy="96" r="35.75" fill="none" stroke="#4ECDC4" strokeWidth="12.5" />
    </svg>
  );
}

function initials(me) {
  const source = (me.name || me.email || '?').split('@')[0];
  const parts = source.split(/[.\s_-]+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

function UserMenu({ me }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="avatar" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(o => !o)} title={me.email}>
        {initials(me)}
      </button>
      {open && (
        <div className="user-popover" role="menu">
          <div className="user-popover-head">
            <strong>{me.name || me.email}</strong>
            <span>{me.email}</span>
            {me.membership && <span className="user-popover-org">{me.membership.organizationName}</span>}
          </div>
          <a className="user-popover-item" role="menuitem" href={LOGOUT_URL}>Abmelden</a>
        </div>
      )}
    </div>
  );
}

// Schmale Seitenleiste (Rail) für angemeldete Benutzer; auf dem Handy als Leiste unten.
// Welche Einträge erscheinen, ist nur Anzeige – die Rechte prüft der Server.
export default function Shell({ me, section, items, children }) {
  return (
    <div className="shell">
      <nav className="rail" aria-label="Hauptnavigation">
        <Link to="/" className="rail-logo" aria-label="KanzleiMind – Startseite"><LogoMark /></Link>
        <ul className="rail-items">
          {items.map(item => (
            <li key={item.key}>
              <Link to={item.to} className={`rail-item ${section === item.key ? 'is-active' : ''}`} aria-current={section === item.key ? 'page' : undefined}>
                <NavIcon name={item.key} />
                <span className="rail-label">{item.label}</span>
                <span className="rail-label-short" aria-hidden="true">{item.shortLabel || item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
        <UserMenu me={me} />
      </nav>
      <div className="shell-content">{children}</div>
    </div>
  );
}
