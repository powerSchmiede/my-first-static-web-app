const { ROLES } = require('./authz');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Basis-URL für Links in E-Mails. Bewusst aus der Konfiguration, nicht aus
// Anfrage-Headern, damit niemand Einladungslinks auf fremde Domains umbiegen kann.
function baseUrl() {
  const value = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  return /^https?:\/\//.test(value) ? value : '';
}

function invitationLink(token) {
  const base = baseUrl();
  return base ? `${base}/einladung#token=${encodeURIComponent(token)}` : `/einladung#token=${encodeURIComponent(token)}`;
}

async function sendInvitation({ to, organizationName, role, inviterName, token, expiresAt }) {
  const connection = process.env.ACS_CONNECTION_STRING;
  const sender = process.env.EMAIL_SENDER_ADDRESS;
  const link = invitationLink(token);
  if (!connection || !sender || !baseUrl()) return { sent: false, reason: 'not_configured' };

  const roleLabel = (ROLES[role] || {}).label || role;
  const until = new Date(expiresAt).toLocaleDateString('de-DE');
  const subject = `Einladung zu ${organizationName}`;
  const plainText = [
    'Hallo,',
    '',
    `${inviterName || 'Ein Administrator'} hat dich zur Organisation „${organizationName}“ eingeladen (Rolle: ${roleLabel}).`,
    '',
    `Einladung annehmen: ${link}`,
    '',
    `Der Link ist bis ${until} gültig und funktioniert nur mit dieser E-Mail-Adresse.`,
    'Wenn du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.',
  ].join('\n');
  const html = `<p>Hallo,</p>
<p>${escapeHtml(inviterName || 'Ein Administrator')} hat dich zur Organisation <strong>${escapeHtml(organizationName)}</strong> eingeladen (Rolle: ${escapeHtml(roleLabel)}).</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#17171A;color:#fff;border-radius:7px;text-decoration:none">Einladung annehmen</a></p>
<p style="color:#6E6E74;font-size:13px">Der Link ist bis ${escapeHtml(until)} gültig und funktioniert nur mit dieser E-Mail-Adresse. Wenn du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.</p>`;

  try {
    const { EmailClient } = require('@azure/communication-email');
    const client = new EmailClient(connection);
    const poller = await client.beginSend({
      senderAddress: sender,
      content: { subject, plainText, html },
      recipients: { to: [{ address: to }] },
    });
    const result = await poller.pollUntilDone();
    return { sent: result.status === 'Succeeded', reason: result.status === 'Succeeded' ? '' : 'send_failed' };
  } catch (e) {
    console.error('E-Mail-Versand fehlgeschlagen', e.message);
    return { sent: false, reason: 'send_failed' };
  }
}

module.exports = { sendInvitation, invitationLink };
