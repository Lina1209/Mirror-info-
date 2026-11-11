function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function clean(value, maxLength = 1000) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sendTelegram(env, order) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const fields = [
    `<b>Новая заявка ${escapeHtml(order.id)}</b>`,
    `<b>Имя:</b> ${escapeHtml(order.name)}`,
    `<b>Email:</b> ${escapeHtml(order.email)}`,
    `<b>Телефон / Telegram:</b> ${escapeHtml(order.phone || '—')}`,
    `<b>Услуга:</b> ${escapeHtml(order.service)}`,
    `<b>Формат:</b> ${escapeHtml(order.format)}`,
    `<b>Язык:</b> ${escapeHtml(order.language)}`,
    `<b>Объём:</b> ${escapeHtml(order.chars || '—')}`,
    `<b>Способ оплаты:</b> ${escapeHtml(order.payment || '—')}`,
    `<b>Расчёт:</b> ${escapeHtml(order.estimate || '—')}`,
    `<b>Файл:</b> ${escapeHtml(order.file_link || '—')}`,
    `<b>Комментарий:</b> ${escapeHtml(order.comment || '—')}`
  ];
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: fields.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true })
  });
  return response.ok;
}

async function sendEmail(env, order) {
  if (!env.RESEND_API_KEY || !env.ORDER_EMAIL_TO || !env.ORDER_EMAIL_FROM) return false;
  const html = `<h2>Новая заявка ${escapeHtml(order.id)}</h2><dl>${[
    ['Имя', order.name], ['Email', order.email], ['Телефон / Telegram', order.phone],
    ['Услуга', order.service], ['Формат', order.format], ['Язык', order.language],
    ['Объём', order.chars], ['Способ оплаты', order.payment], ['Расчёт', order.estimate],
    ['Ссылка на файл', order.file_link], ['Комментарий', order.comment]
  ].map(([label, value]) => `<dt><strong>${escapeHtml(label)}</strong></dt><dd>${escapeHtml(value || '—')}</dd>`).join('')}</dl>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.ORDER_EMAIL_FROM, to: [env.ORDER_EMAIL_TO], reply_to: order.email, subject: `Новая заявка ${order.id}`, html })
  });
  return response.ok;
}

export { clean, escapeHtml, json, sendEmail, sendTelegram, sha256, validateEmail };
