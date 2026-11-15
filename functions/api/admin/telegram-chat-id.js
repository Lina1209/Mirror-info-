export async function onRequestGet({ request, env }) {
  if (!request.headers.get('Cf-Access-Jwt-Assertion')) {
    return new Response('Требуется авторизация', { status: 401 });
  }

  if (!env.TELEGRAM_BOT_TOKEN) {
    return Response.json({ ok: false, error: 'Токен не настроен' }, { status: 503 });
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`
    );

    const data = await response.json();

    if (!data.ok) {
      return Response.json({
        ok: false,
        error: 'Telegram не вернул обновления. Проверьте настройки бота.'
      }, { status: 502 });
    }

    const messages = (data.result || [])
      .filter(item => item.message?.chat?.type === 'private')
      .map(item => ({
        chat_id: item.message.chat.id,
        username: item.message.from?.username || ''
      }));

    if (!messages.length) {
      return Response.json({
        ok: false,
        error: 'Сообщение не найдено. Отправьте боту слово Тест.'
      });
    }

    return Response.json({
      ok: true,
      chats: messages
    });
  } catch (_) {
    return Response.json({
      ok: false,
      error: 'Не удалось связаться с Telegram.'
    }, { status: 502 });
  }
}
