document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const form = document.getElementById('orderForm');
  const statusWrap = document.getElementById('orderStatus');
  const statusText = statusWrap?.querySelector('span');
  const successWrap = document.getElementById('orderSuccess');
  const successText = document.getElementById('orderSuccessText');
  const submitButton = document.getElementById('orderSubmit');
  if (!form) return;

  // Honeypot field: real users never see or fill this field.
  const trap = document.createElement('input');
  trap.type = 'text';
  trap.name = 'website';
  trap.autocomplete = 'off';
  trap.tabIndex = -1;
  trap.setAttribute('aria-hidden', 'true');
  trap.style.cssText = 'position:absolute;left:-10000px;width:1px;height:1px;opacity:0';
  form.appendChild(trap);

  function showError(message) {
    if (!statusWrap || !statusText) return;
    statusText.textContent = message;
    statusWrap.classList.remove('hidden');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const data = Object.fromEntries(new FormData(form).entries());
    const estimate = document.getElementById('orderEstimate')?.textContent || '';
    data.estimate = estimate;

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
    }
    if (statusWrap) statusWrap.classList.add('hidden');

    try {
      if (!window.AppAPI?.submitOrder) throw new Error('Сервис заявок временно недоступен.');
      const result = await window.AppAPI.submitOrder(data);
      form.reset();
      if (successWrap) successWrap.classList.remove('hidden');
      if (successText) {
        successText.textContent = result.notificationsSent === false
          ? 'Заявка сохранена. Уведомление администратору задерживается; заявка не потеряна.'
          : 'Заявка получена. Мы ответим по указанному адресу.';
      }
      successWrap?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      showError(error.message || 'Не удалось отправить заявку. Попробуйте ещё раз.');
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
      }
    }
  });
});
