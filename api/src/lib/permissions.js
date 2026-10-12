// Rechte-Katalog. Neue Bereiche oder Systemrechte werden hier ergänzt; Oberfläche und
// Prüfungen übernehmen sie automatisch.
//
// Ebene 1 (heute): Bereichsrechte "module.<bereich>" – darf jemand den Bereich öffnen.
// Ebene 2 (später): Objektrechte, z. B. Zugriffslisten pro Dokument-Ordner. Sie gelten
// zusätzlich zum Bereichsrecht und werden am Objekt gespeichert, nicht hier.
//
// Wirksam ist ein Bereichsrecht nur, wenn
//   1. der Plattform-Admin den Bereich für die Organisation freigeschaltet hat und
//   2. der Benutzer das Recht in seiner Organisation besitzt.
// Auch Org-Admins und Plattform-Admins erhalten keinen Bereich automatisch.

const { HttpError } = require('./errors');

const MODULES = [
  { key: 'todos', title: 'To-dos', description: 'Aufgaben der Organisation sehen und bearbeiten' },
  { key: 'fibu', title: 'Finanzbuchhaltung', description: 'Zugriff auf den Bereich FiBu' },
  { key: 'lohn', title: 'Lohn', description: 'Zugriff auf den Bereich Lohn (sensible Personaldaten)' },
  { key: 'dokumente', title: 'Dokumente', description: 'Zugriff auf den Dokumentenbereich (Ordnerrechte folgen)' },
];

const MODULE_KEYS = MODULES.map(m => m.key);

const CATALOG = MODULES.map(m => ({
  key: `module.${m.key}`,
  module: m.key,
  group: 'Bereiche',
  label: m.title,
  description: m.description,
}));

const PERMISSION_KEYS = CATALOG.map(p => p.key);

function moduleOf(permission) {
  const entry = CATALOG.find(p => p.key === permission);
  return entry ? entry.module : null;
}

function validateModules(value) {
  if (!Array.isArray(value) || value.some(m => !MODULE_KEYS.includes(m))) {
    throw new HttpError(400, 'Unbekannter Bereich.');
  }
  return MODULE_KEYS.filter(m => value.includes(m));
}

function validatePermissions(value) {
  if (!Array.isArray(value) || value.length > 200 || value.some(p => !PERMISSION_KEYS.includes(p))) {
    throw new HttpError(400, 'Unbekanntes Recht.');
  }
  return PERMISSION_KEYS.filter(p => value.includes(p));
}

// Gespeicherte Rechte bleiben erhalten, wirken aber nur für freigeschaltete Bereiche.
function effectivePermissions(userPermissions, orgModules) {
  return (userPermissions || []).filter(p => {
    const module = moduleOf(p);
    return module && (orgModules || []).includes(module);
  });
}

function parseList(value) {
  try {
    const list = JSON.parse(value || '[]');
    return Array.isArray(list) ? list.filter(v => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

module.exports = { MODULES, MODULE_KEYS, CATALOG, PERMISSION_KEYS, moduleOf, validateModules, validatePermissions, effectivePermissions, parseList };
