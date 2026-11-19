import { json } from '../../_lib/orders.js';
import { authorizeAccess } from '../../_lib/access.js';

export async function onRequest({ request, env }) {
  const identity = await authorizeAccess(request, env, 'admin');

  if (!identity.ok) {
    return json({
      error: identity.status === 403
        ? 'У этой учётной записи нет прав для управления заявками.'
        : 'Не удалось подтвердить доступ.',
      code: identity.code
    }, identity.status);
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

      return json({ orders: result.results || [], role: identity.role });
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
