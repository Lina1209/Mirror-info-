import { json } from '../_lib/orders.js';

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
}

async function getAccessIdentity(request, env) {
  const team = env.CF_ACCESS_TEAM;
  const audience = env.CF_ACCESS_AUD;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!team || !audience || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch (_) { return null; }
  const issuer = `https://${team}.cloudflareaccess.com`;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== issuer || !audiences.includes(audience) || !payload.sub || !payload.exp || payload.exp <= now || (payload.nbf && payload.nbf > now) || header.alg !== 'RS256' || !header.kid) return null;
  try {
    const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { cf: { cacheTtl: 300 } });
    if (!response.ok) return null;
    const certs = await response.json();
    const jwk = certs.keys?.find((key) => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return valid && typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  } catch (error) {
    console.error('Account Access token verification failed', error);
    return null;
  }
}

export async function onRequestGet({ request, env }) {
  if (request.headers.get('Origin') && request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'Запрос отклонён.' }, 403);
  const email = await getAccessIdentity(request, env);
  if (!email) return json({ error: 'Войдите через Cloudflare Access, чтобы открыть личный кабинет.' }, 401);
  if (!env.DB) return json({ error: 'База заявок не настроена.' }, 503);
  try {
    const result = await env.DB.prepare(
      'SELECT id, status, service, format, chars, language, estimate, created_at FROM orders WHERE lower(email) = ? ORDER BY created_at DESC LIMIT 100'
    ).bind(email).all();
    return json({ email, orders: result.results || [] });
  } catch (error) {
    console.error('Account history query failed', error);
    return json({ error: 'Не удалось загрузить историю заявок.' }, 503);
  }
}
