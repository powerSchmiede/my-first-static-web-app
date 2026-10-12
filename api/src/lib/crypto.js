// Verschlüsselung sensibler Felder (Lohndaten) mit AES-256-GCM.
// Der Schlüssel liegt getrennt von der Datenbank in der Umgebungsvariable
// PROFILE_ENCRYPTION_KEY (32 Byte, Base64). Wer nur die Datenbank sieht, sieht keine Lohndaten.
// Format: "v1:<iv>:<tag>:<ciphertext>" (Base64) – die Version erlaubt einen späteren Schlüsselwechsel.

const crypto = require('crypto');
const { HttpError } = require('./errors');

const VERSION = 'v1';

function key() {
  const raw = process.env.PROFILE_ENCRYPTION_KEY || '';
  let buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    buffer = Buffer.alloc(0);
  }
  if (buffer.length !== 32) return null;
  return buffer;
}

function isConfigured() {
  return !!key();
}

function requireKey() {
  const k = key();
  if (!k) throw new HttpError(503, 'Die Verschlüsselung für Lohndaten ist noch nicht eingerichtet.', 'encryption_not_configured');
  return k;
}

// associatedData bindet den Inhalt an Organisation und Benutzer: ein in eine andere
// Zeile kopierter Datensatz lässt sich nicht entschlüsseln.
function encryptJson(value, associatedData) {
  const k = requireKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decryptJson(payload, associatedData) {
  if (!payload) return null;
  const k = requireKey();
  const [version, iv, tag, data] = String(payload).split(':');
  if (version !== VERSION || !iv || !tag || !data) throw new HttpError(500, 'Gespeicherte Lohndaten sind nicht lesbar.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const text = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    return JSON.parse(text);
  } catch {
    throw new HttpError(500, 'Gespeicherte Lohndaten sind nicht lesbar (falscher Schlüssel?).');
  }
}

module.exports = { isConfigured, encryptJson, decryptJson };
