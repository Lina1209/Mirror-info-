document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const form = document.getElementById('orderForm');
  const statusWrap = document.getElementById('orderStatus');
  const statusText = statusWrap?.querySelector('span');
  const successWrap = document.getElementById('orderSuccess');
  const successText = document.getElementById('orderSuccessText');

  if (!form) return;

  const showStatus = (message, type = 'error') => {
    if (!statusWrap || !statusText) return;
    statusText.textContent = message;
    statusWrap.classList.remove('hidden');
    statusWrap.dataset.type = type;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    if (!payload.orderName || !payload.orderEmail) {
      showStatus('Укажите имя и email для отправки заявки.');
      return;
    }

    try {
      let result = { ok: true };
      if (window.AppAPI && typeof window.AppAPI.submitOrder === 'function') {
        result = await window.AppAPI.submitOrder(payload);
      }
      if (!result || result.ok !== true) {
        throw new Error('Не удалось сохранить заявку.');
      }

      form.reset();
      if (statusWrap) statusWrap.classList.add('hidden');
      if (successWrap) successWrap.classList.remove('hidden');
      if (successText) {
        successText.textContent = 'Мы получили заявку и ответим в течение 30 минут.';
      }
    } catch (error) {
      showStatus(error.message || 'Не удалось отправить заявку. Попробуйте ещё раз.');
    }
  });
});
