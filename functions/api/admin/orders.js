import { json } from '../../_lib/orders.js';

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(
    atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')),
    (char) => char.charCodeAt(0)
  );
}

function getCookie(request, name) {
  const cookies = request.headers.get('Cookie') || '';
  const item = cookies.split(';').map(v => v.trim())
    .find(v => v.startsWith(name + '='));
  return item ? item.slice(name.length + 1) : null;
}

export async function verifyAccess(request, env) {
  const team = env.CF_ACCESS_TEAM;
  const audience = env.CF_ACCESS_AUD;

  if (!team) return 'access_team_not_configured';
  if (!audience) return 'access_audience_not_configured';

  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ||
    getCookie(request, 'CF_Authorization');

  if (!token) return 'access_token_missing';

  const parts = token.split('.');
  if (parts.length !== 3) return 'access_token_invalid';

  let header, payload;

  try {
    header = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(parts[0]))
    );
    payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(parts[1]))
    );
  } catch (_) {
    return 'access_token_invalid';
  }

  const issuer = `https://${team}.cloudflareaccess.com`;
  const audList = Array.isArray(payload.aud)
    ? payload.aud
    : [payload.aud];

  const now = Math.floor(Date.now() / 1000);

  if (payload.iss !== issuer) return 'access_issuer_mismatch';
  if (!audList.includes(audience)) return 'access_audience_mismatch';
  if (!payload.sub) return 'access_subject_missing';
  if (!payload.exp || payload.exp <= now) return 'access_token_expired';
  if (payload.nbf && payload.nbf > now) return 'access_token_not_yet_valid';
  if (header.alg !== 'RS256' || !header.kid) {
    return 'access_algorithm_invalid';
  }

  try {
    const response = await fetch(
      `${issuer}/cdn-cgi/access/certs`
    );

    if (!response.ok) return 'access_keys_unavailable';

    const certs = await response.json();
    const jwk = certs.keys?.find(
      key => key.kid === header.kid && key.kty === 'RSA'
    );

    if (!jwk) return 'access_signing_key_not_found';

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256'
      },
      false,
      ['verify']
    );

    const signed = new TextEncoder().encode(
      `${parts[0]}.${parts[1]}`
    );

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      decodeBase64Url(parts[2]),
      signed
    );

    return valid ? null : 'access_signature_invalid';

  } catch (error) {
    console.error('Access verification failed', error);
    return 'access_verification_error';
  }
}

export async function onRequest({ request, env }) {
  const authError = await verifyAccess(request, env);

  if (authError) {
    return json({
      error: 'Требуется авторизация.',
      code: authError
    }, 401);
  }

  if (
    request.headers.get('Origin') &&
    request.headers.get('Origin') !== new URL(request.url).origin
  ) {
    return json({ error: 'Запрос отклонён.' }, 403);
  }

  if (!env.DB) {
    return json({ error: 'База данных не настроена.' }, 503);
  }

  if (request.method === 'GET') {
    try {
      const result = await env.DB.prepare(
        `SELECT id, status, name, email, phone, payment, service,
        format, chars, language, file_link, comment, estimate,
        created_at FROM orders ORDER BY created_at DESC LIMIT 500`
      ).all();

      return json({ orders: result.results || [] });
    } catch (error) {
      console.error('Admin orders query failed', error);
      return json({ error: 'Не удалось получить заявки.' }, 503);
    }
  }

  if (request.method === 'PATCH') {
    let input;

    try {
      input = await request.json();
    } catch (_) {
      return json({ error: 'Некорректный запрос.' }, 400);
    }

    const id = String(input.id || '').slice(0, 64);
    const status = String(input.status || '');

    if (
      !id ||
      !['Новая', 'В работе', 'Выполнена', 'Отменена'].includes(status)
    ) {
      return json({
        error: 'Недопустимый статус или номер заявки.'
      }, 400);
    }

    try {
      const result = await env.DB.prepare(
        'UPDATE orders SET status = ? WHERE id = ?'
      ).bind(status, id).run();

      if (!result.meta?.changes) {
        return json({ error: 'Заявка не найдена.' }, 404);
      }

      return json({ ok: true });
    } catch (error) {
      console.error('Admin order update failed', error);
      return json({ error: 'Не удалось обновить заявку.' }, 503);
    }
  }

  return json({ error: 'Метод не поддерживается.' }, 405);
}