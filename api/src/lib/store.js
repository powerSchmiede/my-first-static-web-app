const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { TableClient } = require('@azure/data-tables');
const { BlobServiceClient } = require('@azure/storage-blob');

const TABLE_NAME = 'apps';
const CONTAINER_NAME = 'app-files';
const PARTITION = 'app';

// Muss zu den Schlüsseln in src/designs.js passen.
const ICONS = ['headset', 'layout', 'sparkle', 'chart', 'presentation', 'translate', 'chat', 'document', 'team', 'book', 'image', 'link'];
const BACKGROUNDS = ['rings', 'grid', 'network', 'bars', 'path', 'letters', 'aurora', 'lines', 'star', 'city', 'squares'];
const TYPES = ['html', 'link', 'none'];

const MAX_HTML_BYTES = 10 * 1024 * 1024;

const DEFAULT_APPS = [
  { id: 'support-apps', title: 'Support Apps', type: 'none', icon: 'headset', background: 'rings' },
  { id: 'marketingvorlagen', title: 'Marketingvorlagen', type: 'none', icon: 'layout', background: 'grid' },
  { id: 'gkk-ai-land', title: 'KanzleiMind AI-Land', type: 'none', icon: 'sparkle', background: 'network' },
  { id: 'levelup', title: 'LevelUP', type: 'none', icon: 'chart', background: 'bars' },
  { id: 'onboarding', title: 'Onboarding', type: 'none', icon: 'presentation', background: 'path' },
  { id: 'translation-services', title: 'Translation Services', type: 'none', icon: 'translate', background: 'letters' },
  { id: 'copilot-chat', title: 'Copilot Chat', type: 'none', icon: 'chat', background: 'aurora' },
  { id: 'otto-schmidt-answers', title: 'Otto Schmidt Answers', type: 'none', icon: 'document', background: 'lines' },
  { id: 'gkk-team', title: 'KanzleiMind Team', type: 'none', icon: 'team', background: 'star' },
  { id: 'schweitzer', title: 'Schweitzer', type: 'none', icon: 'book', background: 'city' },
  { id: 'ki-bild-check', title: 'KI-Bild-Check', type: 'html', icon: 'image', background: 'squares' },
];

const { HttpError } = require('./errors');


let ready;

function connect() {
  const connection = process.env.STORAGE_CONNECTION_STRING;
  if (!connection) throw new HttpError(500, 'STORAGE_CONNECTION_STRING ist nicht konfiguriert.');
  return {
    table: TableClient.fromConnectionString(connection, TABLE_NAME, { allowInsecureConnection: true }),
    container: BlobServiceClient.fromConnectionString(connection).getContainerClient(CONTAINER_NAME),
  };
}

async function seed(table) {
  try {
    await table.getEntity('meta', 'seeded');
    return;
  } catch (e) {
    if (e.statusCode !== 404) throw e;
  }
  for (const [order, app] of DEFAULT_APPS.entries()) {
    await table.upsertEntity({
      partitionKey: PARTITION,
      rowKey: app.id,
      title: app.title,
      type: app.type,
      url: app.url || '',
      icon: app.icon,
      background: app.background,
      hasFile: false,
      order,
    });
  }
  await table.upsertEntity({ partitionKey: 'meta', rowKey: 'seeded' });
}

// Mitgelieferte HTML-Apps. Sie liegen im API-Paket statt öffentlich unter /tools,
// damit nur freigegebene Organisationen sie abrufen können.
const BUILTIN_HTML = { 'ki-bild-check': path.join(__dirname, '..', '..', 'builtin', 'ki-bild-check.html') };

// Hält mitgelieferte Apps im Blob-Speicher aktuell: Kacheln mit der alten öffentlichen
// Adresse oder ohne Datei werden zu HTML-Apps, neue Versionen der Datei werden übernommen.
// Hat ein Plattform-Admin eine eigene Datei hochgeladen (customFile), bleibt sie unverändert.
async function migrateBuiltins(table, container) {
  for (const [id, file] of Object.entries(BUILTIN_HTML)) {
    let entity;
    try {
      entity = await table.getEntity(PARTITION, id);
    } catch (e) {
      if (e.statusCode === 404) continue;
      throw e;
    }
    const html = fs.readFileSync(file);
    const version = crypto.createHash('sha256').update(html).digest('hex').slice(0, 16);
    const legacyLink = entity.type === 'link' && String(entity.url || '').startsWith('/tools/');
    const builtinHtml = entity.type === 'html' && !entity.customFile;
    if (!legacyLink && !(builtinHtml && (!entity.hasFile || entity.builtinVersion !== version))) continue;
    await container.getBlockBlobClient(`${id}.html`).upload(html, html.length, { blobHTTPHeaders: { blobContentType: 'text/html; charset=utf-8' } });
    await table.updateEntity({ partitionKey: PARTITION, rowKey: id, type: 'html', url: '', hasFile: true, builtinVersion: version }, 'Merge');
  }
}

function init() {
  if (!ready) {
    ready = (async () => {
      const clients = connect();
      try {
        await clients.table.createTable();
      } catch (e) {
        if (e.statusCode !== 409) throw e;
      }
      await clients.container.createIfNotExists();
      await seed(clients.table);
      await migrateBuiltins(clients.table, clients.container);
      return clients;
    })();
    ready.catch(() => { ready = undefined; });
  }
  return ready;
}

function toApp(entity) {
  return {
    id: entity.rowKey,
    title: entity.title,
    type: entity.type,
    url: entity.type === 'link' ? entity.url : '',
    icon: entity.icon,
    background: entity.background,
    hasFile: !!entity.hasFile,
    order: entity.order || 0,
  };
}

async function listApps() {
  const { table } = await init();
  const apps = [];
  for await (const entity of table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION}'` } })) {
    apps.push(toApp(entity));
  }
  return apps.sort((a, b) => a.order - b.order);
}

async function getEntity(table, id) {
  try {
    return await table.getEntity(PARTITION, id);
  } catch (e) {
    if (e.statusCode === 404) throw new HttpError(404, 'Diese App gibt es nicht.');
    throw e;
  }
}

function isValidUrl(url) {
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function validate(input, existing) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 60) throw new HttpError(400, 'Der Name muss 1 bis 60 Zeichen lang sein.');
  if (!TYPES.includes(input.type)) throw new HttpError(400, 'Unbekannte App-Art.');
  if (!ICONS.includes(input.icon)) throw new HttpError(400, 'Unbekanntes Symbol.');
  if (!BACKGROUNDS.includes(input.background)) throw new HttpError(400, 'Unbekannter Hintergrund.');

  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (input.type === 'link' && (url.length > 2000 || !isValidUrl(url))) {
    throw new HttpError(400, 'Bitte eine gültige Adresse eingeben (https://… oder /pfad).');
  }

  const html = typeof input.html === 'string' && input.html ? input.html : null;
  if (html && Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new HttpError(400, 'Die HTML-Datei ist größer als 10 MB.');
  if (input.type === 'html' && !html && !(existing && existing.hasFile)) throw new HttpError(400, 'Bitte eine HTML-Datei auswählen.');

  return { title, type: input.type, url: input.type === 'link' ? url : '', icon: input.icon, background: input.background, html };
}

async function saveFile(container, id, html, hadFile) {
  const blob = container.getBlockBlobClient(`${id}.html`);
  if (html) {
    await blob.upload(html, Buffer.byteLength(html, 'utf8'), { blobHTTPHeaders: { blobContentType: 'text/html; charset=utf-8' } });
    return true;
  }
  return hadFile;
}

async function createApp(input) {
  const { table, container } = await init();
  const data = validate(input, null);
  const apps = await listApps();
  const id = crypto.randomUUID();
  const hasFile = data.type === 'html' ? await saveFile(container, id, data.html, false) : false;
  const entity = {
    partitionKey: PARTITION,
    rowKey: id,
    title: data.title,
    type: data.type,
    url: data.url,
    icon: data.icon,
    background: data.background,
    hasFile,
    order: apps.reduce((max, app) => Math.max(max, app.order), -1) + 1,
  };
  await table.createEntity(entity);
  return toApp(entity);
}

async function updateApp(id, input) {
  const { table, container } = await init();
  const existing = await getEntity(table, id);
  const data = validate(input, existing);
  let hasFile = !!existing.hasFile;
  if (data.type === 'html') {
    hasFile = await saveFile(container, id, data.html, hasFile);
  } else if (hasFile) {
    await container.getBlockBlobClient(`${id}.html`).deleteIfExists();
    hasFile = false;
  }
  const entity = {
    partitionKey: PARTITION,
    rowKey: id,
    title: data.title,
    type: data.type,
    url: data.url,
    icon: data.icon,
    background: data.background,
    hasFile,
    order: existing.order || 0,
    // Eigener Upload ersetzt eine mitgelieferte Datei dauerhaft (siehe migrateBuiltins).
    customFile: !!data.html || !!existing.customFile,
    builtinVersion: existing.builtinVersion || '',
  };
  await table.updateEntity(entity, 'Replace');
  return toApp(entity);
}

async function deleteApp(id) {
  const { table, container } = await init();
  await getEntity(table, id);
  await container.getBlockBlobClient(`${id}.html`).deleteIfExists();
  await table.deleteEntity(PARTITION, id);
}

async function readHtml(id) {
  const { table, container } = await init();
  const entity = await getEntity(table, id);
  if (entity.type !== 'html' || !entity.hasFile) throw new HttpError(404, 'Diese App hat keine HTML-Datei.');
  return container.getBlockBlobClient(`${id}.html`).downloadToBuffer();
}

module.exports = { HttpError, ICONS, BACKGROUNDS, listApps, createApp, updateApp, deleteApp, readHtml };
