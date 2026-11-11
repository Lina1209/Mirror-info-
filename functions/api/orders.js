import { clean, json, sendEmail, sendTelegram, sha256, validateEmail } from '../_lib/orders.js';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'Сервис заявок ещё не настроен.' }, 503);

  let input;
  try {
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 20_000) return json({ ok: false, error: 'Слишком большой запрос.' }, 413);
    input = await request.json();
  } catch (_) {
    return json({ ok: false, error: 'Некорректный запрос.' }, 400);
  }

  // Honeypot field. Silently acknowledge bots without storing/sending anything.
  if (clean(input.website, 200)) return json({ ok: true });

  const order = {
    id: crypto.randomUUID(),
    name: clean(input.orderName, 120),
    email: clean(input.orderEmail, 254).toLowerCase(),
    phone: clean(input.orderPhone, 80),
    payment: clean(input.orderPay, 100),
    service: clean(input.orderService, 160),
    format: clean(input.orderFormat, 100),
    chars: Math.max(0, Math.min(2_000_000, Number.parseInt(input.orderChars, 10) || 0)),
    language: clean(input.orderLang, 80),
    file_link: clean(input.orderLink, 1000),
    comment: clean(input.orderComment, 3000),
    estimate: clean(input.estimate, 120)
  };

  if (!order.name || !validateEmail(order.email)) {
    return json({ ok: false, error: 'Проверьте имя и адрес электронной почты.' }, 400);
  }

  if (order.file_link) {
    try {
      const url = new URL(order.file_link);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid protocol');
    } catch (_) {
      return json({ ok: false, error: 'Ссылка на файл должна быть корректным URL.' }, 400);
    }
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await sha256(`${env.IP_HASH_SALT || 'mirror-info-rate-limit'}:${ip}`);
  try {
    const countResult = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM order_rate_limits WHERE ip_hash = ? AND created_at >= datetime('now', '-10 minutes')"
    ).bind(ipHash).first();
    if ((countResult?.total || 0) >= 5) {
      return json({ ok: false, error: 'Слишком много заявок. Попробуйте через несколько минут.' }, 429);
    }
    await env.DB.prepare('INSERT INTO order_rate_limits (ip_hash) VALUES (?)').bind(ipHash).run();
    await env.DB.prepare(
      `INSERT INTO orders (id, name, email, phone, payment, service, format, chars, language, file_link, comment, estimate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(order.id, order.name, order.email, order.phone, order.payment, order.service, order.format, order.chars, order.language, order.file_link, order.comment, order.estimate).run();
  } catch (error) {
    console.error('Order persistence failed', error);
    return json({ ok: false, error: 'Не удалось сохранить заявку. Попробуйте позже.' }, 503);
  }

  const channels = [];
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) channels.push(() => sendTelegram(env, order));
  if (env.RESEND_API_KEY && env.ORDER_EMAIL_TO && env.ORDER_EMAIL_FROM) channels.push(() => sendEmail(env, order));
  if (!channels.length) {
    console.error('Order saved but no notification channel is configured');
    return json({ ok: true, id: order.id, notificationsSent: false });
  }

  const results = await Promise.all(channels.map(async (send) => {
    try { return await send(); } catch (error) { console.error('Order notification failed', error); return false; }
  }));
  return json({ ok: true, id: order.id, notificationsSent: results.some(Boolean) });
}
