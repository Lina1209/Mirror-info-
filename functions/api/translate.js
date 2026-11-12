import { json } from '../_lib/orders.js';

const ALLOWED_LANGUAGES = new Set(['auto', 'en', 'ru', 'kk', 'uk', 'de', 'fr', 'es', 'it', 'tr', 'zh-CN', 'ja', 'ko', 'ar']);

export async function onRequestPost({ request }) {
  let input;
  try {
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 32_000) return json({ error: 'Слишком большой фрагмент для перевода.' }, 413);
    input = await request.json();
  } catch (_) {
    return json({ error: 'Некорректный запрос.' }, 400);
  }

  const text = typeof input.text === 'string' ? input.text : '';
  const sourceLang = ALLOWED_LANGUAGES.has(input.sourceLang) ? input.sourceLang : 'auto';
  const targetLang = ALLOWED_LANGUAGES.has(input.targetLang) && input.targetLang !== 'auto' ? input.targetLang : 'ru';
  if (!text.trim()) return json({ translation: '' });
  if (text.length > 5000) return json({ error: 'Разделите текст на более короткие фрагменты.' }, 413);

  const params = new URLSearchParams({ client: 'gtx', sl: sourceLang, tl: targetLang, dt: 't', q: text });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (response.status === 429) return json({ error: 'Сервис перевода ограничил запросы. Подождите минуту и попробуйте снова.' }, 429);
    if (!response.ok) return json({ error: 'Сервис перевода временно недоступен.' }, 502);
    const data = await response.json();
    if (!Array.isArray(data?.[0])) return json({ error: 'Сервис вернул неожиданный ответ.' }, 502);
    const translation = data[0].map((item) => (item && item[0]) || '').join('');
    return json({ translation });
  } catch (error) {
    console.error('Translation provider request failed', error);
    return json({ error: error.name === 'AbortError' ? 'Перевод занимает слишком долго. Повторите попытку.' : 'Не удалось связаться с сервисом перевода.' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
