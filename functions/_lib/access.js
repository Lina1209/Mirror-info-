function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(
    atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')),
    (char) => char.charCodeAt(0)
  );
}

function getCookie(request, name) {
  const cookies = request.headers.get('Cookie') || '';
  const item = cookies.split(';').map(value => value.trim())
    .find(value => value.startsWith(name + '='));
  return item ? item.slice(name.length + 1) : null;
}

function failure(code, status = 401) {
  return { ok: false, code, status };
}

/**
 * Verify Cloudflare Access JWT cryptographically, then resolve the role
 * exclusively from server-side Pages environment variables.
 *
 * OWNER_EMAIL: one exact email address.
 * ADMIN_EMAILS: optional comma-separated list of limited administrators.
 */
export async function authorizeAccess(request, env, requiredRole = 'admin') {
  const team = env.CF_ACCESS_TEAM;
  const audience = env.CF_ACCESS_AUD;
  const ownerEmail = String(env.OWNER_EMAIL || '').trim().toLowerCase();

  if (!team) return failure('access_team_not_configured', 503);
  if (!audience) return failure('access_audience_not_configured', 503);
  if (!ownerEmail) return failure('owner_identity_not_configured', 503);

  const token = request.headers.get('Cf-Access-Jwt-Assertion') ||
    getCookie(request, 'CF_Authorization');

  if (!token) return failure('access_token_missing');

  const parts = token.split('.');
  if (parts.length !== 3) return failure('access_token_invalid');

  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch (_) {
    return failure('access_token_invalid');
  }

  const issuer = `https://${team}.cloudflareaccess.com`;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const now = Math.floor(Date.now() / 1000);

  if (payload.iss !== issuer) return failure('access_issuer_mismatch');
  if (!audiences.includes(audience)) return failure('access_audience_mismatch');
  if (typeof payload.sub !== 'string' || !payload.sub) return failure('access_subject_missing');
  if (typeof payload.email !== 'string' || !payload.email.trim()) return failure('access_email_missing');
  if (!Number.isFinite(payload.exp) || payload.exp <= now) return failure('access_token_expired');
  if (payload.nbf && payload.nbf > now) return failure('access_token_not_yet_valid');
  if (header.alg !== 'RS256' || !header.kid) return failure('access_algorithm_invalid');

  try {
    const response = await fetch(`${issuer}/cdn-cgi/access/certs`);
    if (!response.ok) return failure('access_keys_unavailable', 503);

    const certs = await response.json();
    const jwk = certs.keys?.find(key =>
      key.kid === header.kid && key.kty === 'RSA'
    );
    if (!jwk) return failure('access_signing_key_not_found');

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );

    if (!valid) return failure('access_signature_invalid');
  } catch (error) {
    console.error('Cloudflare Access verification failed', error);
    return failure('access_verification_error', 503);
  }

  const email = payload.email.trim().toLowerCase();
  let role = 'guest';

  if (email === ownerEmail) {
    role = 'owner';
  } else {
    const admins = String(env.ADMIN_EMAILS || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
    if (admins.includes(email)) role = 'admin';
  }

  if (role === 'guest') return failure('access_role_forbidden', 403);
  if (requiredRole === 'owner' && role !== 'owner') {
    return failure('owner_role_required', 403);
  }

  return { ok: true, email, subject: payload.sub, role };
}
