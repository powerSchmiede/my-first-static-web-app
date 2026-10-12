// Benutzerprofile: Kontaktdaten (unverschlüsselt) und Lohndaten (verschlüsselt, siehe crypto.js).
// Gespeichert in OrgData (Partition = OrganizationId) als "prof_<userId>".
// Feldnamen orientieren sich an gängigen HR-Systemen (z. B. Personio), damit eine spätere
// Synchronisation die Felder direkt zuordnen kann.

const { table, getOrNull } = require('./tables');
const { HttpError } = require('./errors');
const { encryptJson, decryptJson, isConfigured } = require('./crypto');

const PREFIX = 'prof_';

const DENOMINATIONS = ['', 'keine', 'ev', 'rk', 'sonstige'];
const TAX_CLASSES = ['', '1', '2', '3', '4', '5', '6'];

const text = max => value => {
  const v = typeof value === 'string' ? value.trim() : '';
  if (v.length > max) throw new Error(`höchstens ${max} Zeichen`);
  return v;
};
const pattern = (regex, message, normalize = v => v) => value => {
  const v = normalize(typeof value === 'string' ? value.trim() : '');
  if (v && !regex.test(v)) throw new Error(message);
  return v;
};
const oneOf = (list, message) => value => {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!list.includes(v)) throw new Error(message);
  return v;
};
const date = ({ past } = {}) => value => {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return '';
  const d = new Date(`${v}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900) throw new Error('ungültiges Datum');
  if (past && d > new Date()) throw new Error('darf nicht in der Zukunft liegen');
  return v;
};
const number = (min, max, step) => value => {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max || Math.round(n / step) * step !== n) throw new Error(`Zahl zwischen ${min} und ${max}`);
  return String(n);
};

function validIban(value) {
  const iban = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

const iban = value => {
  const v = (typeof value === 'string' ? value : '').replace(/\s+/g, '').toUpperCase();
  if (v && !validIban(v)) throw new Error('ungültige IBAN (Prüfziffer)');
  return v;
};

const CONTACT_FIELDS = {
  firstName: { label: 'Vorname', check: text(60) },
  lastName: { label: 'Nachname', check: text(60) },
  phone: { label: 'Telefon', check: pattern(/^[+0-9 ()/-]{3,40}$/, 'ungültige Telefonnummer') },
  mobile: { label: 'Mobil', check: pattern(/^[+0-9 ()/-]{3,40}$/, 'ungültige Telefonnummer') },
};

const PAYROLL_FIELDS = {
  birthDate: { label: 'Geburtsdatum', check: date({ past: true }) },
  street: { label: 'Straße und Hausnummer', check: text(100) },
  zip: { label: 'PLZ', check: pattern(/^\d{5}$/, 'PLZ mit 5 Ziffern') },
  city: { label: 'Ort', check: text(60) },
  personnelNumber: { label: 'Personalnummer', check: text(20) },
  entryDate: { label: 'Eintrittsdatum', check: date() },
  weeklyHours: { label: 'Wochenstunden', check: number(0, 60, 0.25) },
  taxId: { label: 'Steuer-ID', check: pattern(/^[1-9]\d{10}$/, 'Steuer-ID mit 11 Ziffern', v => v.replace(/\s+/g, '')) },
  taxClass: { label: 'Steuerklasse', check: oneOf(TAX_CLASSES, 'Steuerklasse 1 bis 6') },
  childAllowance: { label: 'Kinderfreibeträge', check: number(0, 10, 0.5) },
  denomination: { label: 'Konfession', check: oneOf(DENOMINATIONS, 'unbekannte Konfession') },
  socialSecurityNumber: { label: 'SV-Nummer', check: pattern(/^\d{8}[A-Z]\d{3}$/, 'SV-Nummer im Format 12 345678 A 123', v => v.replace(/\s+/g, '').toUpperCase()) },
  healthInsurance: { label: 'Krankenkasse', check: text(100) },
  iban: { label: 'IBAN', check: iban },
};

function validate(fields, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Ungültige Anfrage.');
  const result = {};
  for (const [key, field] of Object.entries(fields)) {
    if (input[key] === undefined) continue;
    try {
      result[key] = field.check(input[key]);
    } catch (e) {
      throw new HttpError(400, `${field.label}: ${e.message}.`, 'invalid_field');
    }
  }
  return result;
}

function emptyOf(fields) {
  return Object.fromEntries(Object.keys(fields).map(k => [k, '']));
}

function aad(organizationId, userId) {
  return `${organizationId}|${userId}`;
}

async function load(organizationId, userId) {
  const client = await table('orgData');
  return getOrNull(client, organizationId, PREFIX + userId);
}

async function getProfile(organizationId, userId, { includePayroll }) {
  const entity = await load(organizationId, userId);
  const contact = { ...emptyOf(CONTACT_FIELDS) };
  for (const key of Object.keys(CONTACT_FIELDS)) if (entity && typeof entity[key] === 'string') contact[key] = entity[key];
  let payroll = null;
  if (includePayroll && isConfigured()) {
    payroll = { ...emptyOf(PAYROLL_FIELDS), ...(entity && entity.payroll ? decryptJson(entity.payroll, aad(organizationId, userId)) : {}) };
  }
  return { contact, payroll, payrollConfigured: isConfigured(), updatedAt: entity ? entity.updatedAt || '' : '' };
}

function changedKeys(before, after) {
  return Object.keys(after).filter(k => (before[k] || '') !== (after[k] || ''));
}

async function saveContact(organizationId, userId, input) {
  const data = validate(CONTACT_FIELDS, input);
  const entity = await load(organizationId, userId);
  const before = Object.fromEntries(Object.keys(CONTACT_FIELDS).map(k => [k, entity ? entity[k] || '' : '']));
  const client = await table('orgData');
  await client.upsertEntity({ partitionKey: organizationId, rowKey: PREFIX + userId, ...data, updatedAt: new Date().toISOString() }, 'Merge');
  return changedKeys(before, data).map(k => CONTACT_FIELDS[k].label);
}

async function savePayroll(organizationId, userId, input) {
  const data = validate(PAYROLL_FIELDS, input);
  const entity = await load(organizationId, userId);
  const before = entity && entity.payroll ? decryptJson(entity.payroll, aad(organizationId, userId)) : {};
  const merged = { ...emptyOf(PAYROLL_FIELDS), ...before, ...data };
  const client = await table('orgData');
  await client.upsertEntity({
    partitionKey: organizationId,
    rowKey: PREFIX + userId,
    payroll: encryptJson(merged, aad(organizationId, userId)),
    updatedAt: new Date().toISOString(),
  }, 'Merge');
  return changedKeys(before, data).map(k => PAYROLL_FIELDS[k].label);
}

async function remove(organizationId, userId) {
  const client = await table('orgData');
  await client.deleteEntity(organizationId, PREFIX + userId).catch(e => { if (e.statusCode !== 404) throw e; });
}

module.exports = { getProfile, saveContact, savePayroll, remove, CONTACT_FIELDS, PAYROLL_FIELDS, validIban };
