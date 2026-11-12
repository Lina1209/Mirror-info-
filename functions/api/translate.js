import { json } from '../_lib/orders.js';

const LANGUAGES = new Set(['auto', 'en', 'ru', 'kk', 'uk', 'de', 'fr', 'es', 'it', 'tr', 'zh-CN', 'ja', 'ko', 'ar']);
const MAX_TEXT_CHARS = 1400;
const REQUEST_TIMEOUT_MS = 15_000;

function errorMessage(status) {
  if (status === 429) return 'Сервис перевода временно ограничил запросы. Подождите минуту и попробуйте снова.';
  if (status === 456) return 'Превышена квота переводов. Проверьте тариф и лимиты сервиса перевода.';
  if (status === 403) return 'Сервис перевода отклонил запрос. Проверьте ключ API и настройки доступа.';
  return 'Сервис перевода временно недоступен. Попробуйте ещё раз позже.';
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

async function translateWithDeepL(text, sourceLang, targetLang, apiKey) {
  const lang = (code) => ({ 'zh-CN': 'ZH', auto: undefined })[code] || code.toUpperCase();
  const body = { text: [text], target_lang: lang(targetLang) };
  if (sourceLang !== 'auto') body.source_lang = lang(sourceLang);
  const host = apiKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
  const response = await fetchWithTimeout(`https://${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) return { error: json({ error: errorMessage(response.status) }, response.status === 429 ? 429 : 502) };
  const result = await response.json().catch(() => null);
  const translation = result?.translations?.[0]?.text;
  if (typeof translation !== 'string') return { error: json({ error: 'Сервис перевода вернул некорректный ответ.' }, 502) };
  return { translation };
}

async function translateWithGoogle(text, sourceLang, targetLang) {
  const params = new URLSearchParams({ client: 'gtx', sl: sourceLang, tl: targetLang, dt: 't', q: text });
  const response = await fetchWithTimeout(`https://translate.googleapis.com/translate_a/single?${params}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) return { error: json({ error: errorMessage(response.status) }, response.status === 429 ? 429 : 502) };
  const result = await response.json().catch(() => null);
  if (!Array.isArray(result?.[0])) return { error: json({ error: 'Сервис перевода вернул некорректный ответ.' }, 502) };
  return { translation: result[0].map((item) => (item && item[0]) || '').join('') };
}

export async function onRequestGet() {
  return json({ ok: true, endpoint: '/api/translate', method: 'POST', maxCharactersPerRequest: MAX_TEXT_CHARS });
}

export async function onRequestPost({ request, env }) {
  let input;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 20_000) return json({ error: 'Слишком большой запрос.' }, 413);
    input = JSON.parse(raw);
  } catch (_) {
    return json({ error: 'Некорректный JSON-запрос.' }, 400);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'Некорректный запрос.' }, 400);

  const text = typeof input.text === 'string' ? input.text : '';
  const sourceLang = LANGUAGES.has(input.sourceLang) ? input.sourceLang : 'auto';
  const targetLang = LANGUAGES.has(input.targetLang) && input.targetLang !== 'auto' ? input.targetLang : 'ru';
  if (!text.trim()) return json({ error: 'Передан пустой текст.' }, 400);
  if (text.length > MAX_TEXT_CHARS) return json({ error: `Слишком длинный фрагмент (лимит ${MAX_TEXT_CHARS} символов).` }, 413);
  if (request.headers.get('Origin') && request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'Запрос отклонён.' }, 403);

  try {
    const result = env.DEEPL_API_KEY
      ? await translateWithDeepL(text, sourceLang, targetLang, env.DEEPL_API_KEY)
      : await translateWithGoogle(text, sourceLang, targetLang);
    if (result.error) return result.error;
    if (typeof result.translation !== 'string' || !result.translation.trim()) return json({ error: 'Сервис перевода вернул пустой результат.' }, 502);
    return json({ translation: result.translation });
  } catch (error) {
    console.error('Translation provider request failed', error);
    return json({ error: error.name === 'AbortError' ? 'Поставщик перевода не ответил за 15 секунд. Повторите попытку.' : 'Не удалось связаться с поставщиком перевода.' }, 502);
  }
}
