document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const container = document.getElementById('adminOrdersContainer');
  const message = document.getElementById('adminMessage');
  const refreshButton = document.getElementById('refreshOrders');
  const statuses = ['Новая', 'В работе', 'Выполнена', 'Отменена'];
  if (!container) return;

  function showMessage(text, isError = false) {
    if (!message) return;
    message.textContent = text;
    message.classList.remove('hidden');
    message.classList.toggle('mk-alert', isError);
    message.classList.toggle('mk-success', !isError);
  }

  function addText(parent, tag, label, value) {
    const row = document.createElement(tag);
    const strong = document.createElement('strong');
    strong.textContent = label;
    row.append(strong, document.createTextNode(` ${value || '—'}`));
    parent.appendChild(row);
  }

  function renderOrders(orders) {
    container.replaceChildren();
    if (!orders.length) {
      const empty = document.createElement('div');
      empty.className = 'mk-card p-6 text-center';
      empty.textContent = 'Заявок пока нет.';
      container.appendChild(empty);
      return;
    }

    for (const order of orders) {
      const card = document.createElement('article');
      card.className = 'mk-card p-5';
      const header = document.createElement('div');
      header.className = 'flex flex-wrap justify-between items-center gap-3 pb-3 border-b';
      const title = document.createElement('strong');
      title.textContent = `#${order.id} · ${order.name} (${order.email})`;
      const status = document.createElement('select');
      status.className = 'mk-select';
      status.setAttribute('aria-label', `Статус заявки ${order.id}`);
      for (const value of statuses) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = value === order.status;
        status.appendChild(option);
      }
      status.addEventListener('change', async () => {
        status.disabled = true;
        try {
          await request('/api/admin/orders', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: order.id, status: status.value })
          });
          order.status = status.value;
          showMessage('Статус заявки обновлён.');
        } catch (error) {
          showMessage(error.message, true);
          status.value = order.status;
        } finally {
          status.disabled = false;
        }
      });
      header.append(title, status);
      card.appendChild(header);
      addText(card, 'p', 'Услуга:', order.service);
      addText(card, 'p', 'Язык:', order.language);
      addText(card, 'p', 'Формат:', order.format);
      addText(card, 'p', 'Объём:', order.chars ? `${order.chars} символов` : '—');
      addText(card, 'p', 'Контакт:', order.phone);
      addText(card, 'p', 'Оплата:', order.payment);
      addText(card, 'p', 'Расчёт:', order.estimate);
      addText(card, 'p', 'Дата:', order.created_at);
      if (order.file_link) {
        try {
          const parsed = new URL(order.file_link);
          if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
            const link = document.createElement('a');
            link.href = parsed.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'underline';
            link.textContent = 'Открыть файл клиента';
            card.appendChild(link);
          }
        } catch (_) { /* Ignore malformed submitted URLs. */ }
      }
      if (order.comment) addText(card, 'p', 'Комментарий:', order.comment);
      container.appendChild(card);
    }
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { Accept: 'application/json', ...options.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Ошибка сервера (${response.status}).`);
    return data;
  }

  async function loadOrders() {
    container.textContent = 'Загружаем заявки…';
    if (message) message.classList.add('hidden');
    try {
      const result = await request('/api/admin/orders');
      renderOrders(result.orders || []);
    } catch (error) {
      container.replaceChildren();
      showMessage(error.message || 'Не удалось загрузить заявки.', true);
    }
  }

  refreshButton?.addEventListener('click', loadOrders);
  loadOrders();
});
