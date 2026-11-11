# Публикация Mirror-info с защищённой обработкой заявок

## Архитектура

Фронтенд остаётся статическим и сохраняет существующие HTML/CSS-дизайн. Для production используйте **Cloudflare Pages, подключённый к этому GitHub-репозиторию**: Pages отдаёт сайт, Pages Functions принимают заявки, D1 хранит их, Cloudflare Access защищает админку, а Telegram/Resend отправляют уведомления.

**Не публикуйте bot token, API keys, пароль или секреты в HTML/JavaScript и GitHub Pages.** Чистый GitHub Pages не запускает Functions и не может безопасно хранить секреты. При выборе GitHub Pages как хостинга форма `/api/orders` не будет работать; нужен серверный backend.

## Настройка

1. Создайте Cloudflare Pages project, подключите `Lina1209/Mirror-info-`, production branch `main`, build command оставьте пустым, build output directory — `.`. В корне есть `wrangler.toml`; замените там `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID` на ID созданной D1 базы.
2. Создайте D1 database `mirror-info-orders`, примените схему из корня репозитория:
   ```sh
   npx wrangler d1 create mirror-info-orders
   npx wrangler d1 execute mirror-info-orders --remote --file=./schema.sql
   ```
   В Cloudflare Pages settings проверьте D1 binding с именем `DB` и той же базой. После изменения binding/config выполните новый deploy.
3. В Pages → Settings → Variables and Secrets добавьте секреты/переменные:
   - `TELEGRAM_BOT_TOKEN` (secret) и `TELEGRAM_CHAT_ID` (secret), чтобы получать заявки в Telegram; создайте бота и сначала отправьте ему сообщение, чтобы определить chat ID.
   - либо `RESEND_API_KEY` (secret), `ORDER_EMAIL_TO` и `ORDER_EMAIL_FROM` для email через Resend. Адрес отправителя должен быть подтверждён в Resend.
   - `IP_HASH_SALT` (secret): длинная случайная строка для хеширования IP при ограничении частоты заявок.
   Можно настроить Telegram и email одновременно. Секреты добавляйте отдельно для Production и Preview, если используете оба окружения.
4. В Cloudflare Zero Trust → Access создайте Self-hosted application для домена сайта. Добавьте отдельные policies, разрешающие доступ только вашим email/identity-provider к `/admin.html` и `/api/admin/*`. Проверьте с приватным окном, что обе страницы/API требуют Access. В Pages settings задайте обычные (не секретные) переменные `CF_ACCESS_TEAM` (имя команды из `https://TEAM.cloudflareaccess.com`) и `CF_ACCESS_AUD` (AUD tag приложения Access). API дополнительно проверяет подпись и claims Access JWT — одной проверки интерфейса недостаточно.
5. Включите production deployment и проверьте:
   - отправку тестовой заявки; она должна появиться в D1 и Telegram/email;
   - `/admin.html` без авторизации не показывает заявки;
   - после входа администратор видит данные и может менять статус;
   - лимит запросов на форме срабатывает после нескольких быстрых отправок.

## GitHub Pages или другой хостинг

Эта конфигурация предназначена для Cloudflare Pages Functions. Для обычного GitHub Pages можно публиковать только статическую часть, но нельзя включать в неё секреты или оставлять форму с фиктивным сохранением в браузере. Если хостите фронтенд в другом месте, разверните Functions на серверless-хостинге и задайте `api.js` запрос на его endpoint; настройте CORS только на ваш домен. Не направляйте браузер напрямую в Telegram Bot API.

## Безопасность и ограничения

- Старый пароль `Lina1209` удалён из админского клиентского кода; используйте Cloudflare Access identity policies. Доступ защищён и для страницы, и для API, а JWT проверяется серверной функцией.
- Заказы сохраняются в D1. Уведомления не содержат секретов; при временном сбое каналов запись остаётся в админке.
- Включите MFA у провайдера учётных записей Cloudflare Access и ограничьте доступ точными email. Периодически меняйте Telegram/Resend credentials.
- Не храните лишние персональные данные, настройте срок хранения/удаления заявок и разместите на сайте политику конфиденциальности. Учитывайте требования применимого законодательства о персональных данных.
- Перевод по открытому Google endpoint оставлен как демонстрационная функция и не имеет SLA. Для коммерческого использования подключите поддерживаемый переводческий API через серверную функцию и храните ключ только как Pages secret.
