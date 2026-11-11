import { json } from '../../_lib/orders.js';

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
}

async function verifyAccess(request, env) {
  const team = env.CF_ACCESS_TEAM;
  const audience = env.CF_ACCESS_AUD;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!team || !audience || !token) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch (_) { return false; }

  const issuer = `https://${team}.cloudflareaccess.com`;
  const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== issuer || !audList.includes(audience) || !payload.sub || !payload.exp || payload.exp <= now) return false;
  if (payload.nbf && payload.nbf > now) return false;
  if (header.alg !== 'RS256' || !header.kid) return false;

  try {
    const certResponse = await fetch(`${issuer}/cdn-cgi/access/certs`, { cf: { cacheTtl: 300 } });
    if (!certResponse.ok) return false;
    const certs = await certResponse.json();
    const jwk = certs.keys?.find((key) => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) return false;
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decodeBase64Url(parts[2]), signed);
  } catch (error) {
    console.error('Cloudflare Access JWT verification failed', error);
    return false;
  }
}

export async function onRequest({ request, env }) {
  if (!await verifyAccess(request, env)) return json({ error: 'Требуется авторизация.' }, 401);
  if (request.headers.get('Origin') && request.headers.get('Origin') !== new URL(request.url).origin) {
    return json({ error: 'Запрос отклонён.' }, 403);
  }
  if (!env.DB) return json({ error: 'База данных не настроена.' }, 503);

  if (request.method === 'GET') {
    try {
      const result = await env.DB.prepare(
        'SELECT id, status, name, email, phone, payment, service, format, chars, language, file_link, comment, estimate, created_at FROM orders ORDER BY created_at DESC LIMIT 500'
      ).all();
      return json({ orders: result.results || [] });
    } catch (error) {
      console.error('Admin orders query failed', error);
      return json({ error: 'Не удалось получить заявки.' }, 503);
    }
  }

  if (request.method === 'PATCH') {
    let input;
    try { input = await request.json(); } catch (_) { return json({ error: 'Некорректный запрос.' }, 400); }
    const id = String(input.id || '').slice(0, 64);
    const status = String(input.status || '');
    if (!id || !['Новая', 'В работе', 'Выполнена', 'Отменена'].includes(status)) {
      return json({ error: 'Недопустимый статус или номер заявки.' }, 400);
    }
    try {
      const result = await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(status, id).run();
      if (!result.meta?.changes) return json({ error: 'Заявка не найдена.' }, 404);
      return json({ ok: true });
    } catch (error) {
      console.error('Admin order update failed', error);
      return json({ error: 'Не удалось обновить заявку.' }, 503);
    }
  }

  return json({ error: 'Метод не поддерживается.' }, 405);
}
