import React, { useEffect, useRef, useState } from 'react';
import { backgrounds, icons, DEFAULT_BACKGROUND, DEFAULT_ICON } from './designs';
import { TileArt } from './Tile';
import { createApp, updateApp, deleteApp } from './api';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const TYPE_LABELS = {
  html: 'HTML-Datei',
  link: 'Link',
  none: 'Demnächst',
};

export function Modal({ title, onClose, children }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    const first = dialogRef.current && dialogRef.current.querySelector('.modal-body input, .modal-body select, .modal-body button');
    if (first) first.focus();
    const onKey = e => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (previous && previous.focus) previous.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={dialogRef}>
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12 M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Picker({ legend, name, value, onChange, options, renderSwatch }) {
  return (
    <fieldset className="picker">
      <legend>{legend}</legend>
      <div className="picker-grid">
        {Object.entries(options).map(([key, option]) => (
          <label key={key} className="picker-option" title={option.label}>
            <input type="radio" name={name} value={key} checked={value === key} onChange={() => onChange(key)} />
            <span className="picker-swatch">{renderSwatch(key)}</span>
            <span className="sr-only">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const ALL_TYPES = ['html', 'link', 'none'];
const savePlatformApp = (app, data) => (app ? updateApp(app.id, data) : createApp(data));

// types: erlaubte Arten. Org-Admins und Benutzer dürfen nur Links anlegen.
// save(app, data): speichert neu (app = null) oder geändert.
export function AppForm({ app, onSaved, onCancel, types = ALL_TYPES, save = savePlatformApp, urlHint }) {
  const editing = !!app;
  const [title, setTitle] = useState(editing ? app.title : '');
  const [type, setType] = useState(editing && types.includes(app.type) ? app.type : types[0]);
  const [url, setUrl] = useState(editing && app.type === 'link' ? app.url : '');
  const [icon, setIcon] = useState(editing ? app.icon : DEFAULT_ICON);
  const [background, setBackground] = useState(editing ? app.background : DEFAULT_BACKGROUND);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const keepsFile = editing && app.type === 'html' && app.hasFile;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!title.trim()) return setError('Bitte einen Namen eingeben.');
    if (type === 'link' && !url.trim()) return setError('Bitte eine Adresse eingeben.');
    if (type === 'html' && !file && !keepsFile) return setError('Bitte eine HTML-Datei auswählen.');
    if (file && file.size > MAX_FILE_BYTES) return setError('Die HTML-Datei ist größer als 10 MB.');

    setSaving(true);
    try {
      const data = { title: title.trim(), type, url: url.trim(), icon, background };
      if (type === 'html' && file) data.html = await file.text();
      const saved = await save(editing ? app : null, data);
      onSaved(saved);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="app-form" onSubmit={submit} noValidate>
      <div className="form-main">
        <label className="field">
          <span>Name</span>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={60} placeholder="z. B. KI-Bild-Check" required />
        </label>

        {types.length > 1 && <fieldset className="field">
          <legend>Art der App</legend>
          <div className="segmented">
            {Object.entries(TYPE_LABELS).filter(([key]) => types.includes(key)).map(([key, label]) => (
              <label key={key}>
                <input type="radio" name="type" value={key} checked={type === key} onChange={() => setType(key)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>}

        {type === 'html' && (
          <label className="field">
            <span>HTML-Datei</span>
            <input type="file" accept=".html,.htm,text/html" onChange={e => setFile(e.target.files[0] || null)} />
            <small>
              {keepsFile
                ? 'Ohne neue Auswahl bleibt die bisherige Datei erhalten.'
                : 'Eine einzelne, eigenständige HTML-Datei (max. 10 MB). Verweise auf weitere Dateien funktionieren nicht.'}
            </small>
          </label>
        )}

        {type === 'link' && (
          <label className="field">
            <span>Adresse</span>
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" />
            <small>{urlHint || 'Externe Adressen und SharePoint-Seiten öffnen sich in einem neuen Tab.'}</small>
          </label>
        )}

        {type === 'none' && (
          <p className="hint">Die Kachel wird angezeigt, lässt sich aber noch nicht öffnen.</p>
        )}

        <Picker
          legend="Symbol"
          name="icon"
          value={icon}
          onChange={setIcon}
          options={icons}
          renderSwatch={key => (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[key].path} /></svg>
          )}
        />
        <Picker
          legend="Hintergrund"
          name="background"
          value={background}
          onChange={setBackground}
          options={backgrounds}
          renderSwatch={key => <TileArt uid={`pick-${key}`} icon={null} background={key} className="tile-art-mini" />}
        />
      </div>

      <div className="form-side">
        <span className="preview-label">Vorschau</span>
        <div className="tile tile-preview">
          <TileArt uid="preview" icon={icon} background={background} />
          <div className="tile-title"><span>{title.trim() || 'Neue App'}</span>{type === 'none' && <span className="tile-soon">Demnächst</span>}</div>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>Abbrechen</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Speichern …' : editing ? 'Änderungen speichern' : 'App anlegen'}</button>
      </div>
    </form>
  );
}

export function ManageList({ apps, onEdit, onChanged, remove = deleteApp, extra, emptyText = 'Es sind noch keine Apps angelegt.' }) {
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  async function handleRemove(id) {
    setBusyId(id);
    setError('');
    try {
      await remove(id);
      setConfirmId(null);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (!apps.length) return <p className="hint">{emptyText}</p>;

  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}
      <ul className="manage-list">
        {apps.map(app => (
          <li key={app.id} className="manage-row">
            <TileArt uid={`manage-${app.id}`} icon={app.icon} background={app.background} iconSize={20} className="tile-art-mini" />
            <div className="manage-info">
              <strong>{app.title}</strong>
              <span>{TYPE_LABELS[app.type]}{app.type === 'link' ? ` · ${app.url}` : ''}</span>
            </div>
            <div className="manage-actions">
              {confirmId === app.id ? (
                <>
                  <span className="confirm-text">Wirklich löschen?</span>
                  <button type="button" className="btn btn-danger" onClick={() => handleRemove(app.id)} disabled={busyId === app.id}>
                    {busyId === app.id ? 'Löschen …' : 'Ja, löschen'}
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmId(null)} disabled={busyId === app.id}>Nein</button>
                </>
              ) : (
                <>
                  {extra && extra(app)}
                  <button type="button" className="btn" onClick={() => onEdit(app)}>Bearbeiten</button>
                  <button type="button" className="btn" onClick={() => setConfirmId(app.id)}>Löschen</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
