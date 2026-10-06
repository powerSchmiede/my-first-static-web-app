const crypto = require('crypto');
const { table, odata } = require('./tables');

// Nur anhängend: Es gibt bewusst keine Funktionen zum Ändern einzelner Einträge.
// Einzige Ausnahme ist das Löschen einer ganzen Organisation (purgeOrganization);
// der Vorgang selbst bleibt im Plattform-Protokoll stehen.

const PLATFORM_PARTITION = '_platform';
const MAX_TIME = 9999999999999;

function rowKey() {
  // Umgekehrte Zeit, damit die neuesten Einträge zuerst gelesen werden.
  return `${String(MAX_TIME - Date.now()).padStart(13, '0')}_${crypto.randomUUID().slice(0, 8)}`;
}

function actorOf(ctx) {
  if (!ctx || !ctx.principal) return { actorIdentity: 'anonymous', actorEmail: '' };
  return { actorIdentity: ctx.principal.identityId, actorEmail: ctx.principal.email };
}

async function record(ctx, { organizationId, action, targetType = '', targetId = '', result = 'success', details = {} }) {
  try {
    const client = await table('audit');
    await client.createEntity({
      partitionKey: organizationId || PLATFORM_PARTITION,
      rowKey: rowKey(),
      timestamp: new Date().toISOString(),
      ...actorOf(ctx),
      action,
      targetType,
      targetId,
      result,
      details: JSON.stringify(details).slice(0, 8000),
    });
  } catch (e) {
    // Audit darf den eigentlichen Vorgang nicht abbrechen, muss aber auffallen.
    console.error('Audit-Eintrag konnte nicht geschrieben werden', action, e);
  }
}

async function list(organizationId, limit = 100) {
  if (!organizationId) throw new Error('organizationId fehlt');
  const client = await table('audit');
  const items = [];
  for await (const entity of client.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${organizationId}` } })) {
    items.push({
      id: entity.rowKey,
      timestamp: entity.timestamp,
      actorEmail: entity.actorEmail,
      action: entity.action,
      targetType: entity.targetType,
      targetId: entity.targetId,
      result: entity.result,
      details: safeParse(entity.details),
    });
    if (items.length >= limit) break;
  }
  return items;
}

async function purgeOrganization(organizationId) {
  if (!organizationId || organizationId === PLATFORM_PARTITION) throw new Error('Ungültige Organisation');
  const client = await table('audit');
  const keys = [];
  for await (const entity of client.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${organizationId}`, select: ['RowKey'] } })) {
    keys.push(entity.rowKey);
  }
  for (let i = 0; i < keys.length; i += 100) {
    await client.submitTransaction(keys.slice(i, i + 100).map(rowKey => ['delete', { partitionKey: organizationId, rowKey }]));
  }
  return keys.length;
}

function safeParse(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

module.exports = { record, list, purgeOrganization, PLATFORM_PARTITION };
