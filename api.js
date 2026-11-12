(function (window) {
  'use strict';
  const FALLBACK_RATES = { RUB: 1, KZT: 5.2, USD: 0.011, EUR: 0.010, BYN: 0.035, UAH: 0.45, GBP: 0.0085, CNY: 0.078, TRY: 0.37 };
  window.AppAPI = window.AppAPI || {};
  window.AppAPI.getExchangeRates = async function () {
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/RUB');
      if (!response.ok) throw new Error('Rates unavailable');
      const data = await response.json();
      if (data?.result === 'success' && data.rates) return { rates: data.rates, isLive: true, updatedAt: new Date().toLocaleDateString('ru-RU') };
    } catch (_) { /* Use fallback rates if the exchange service is offline. */ }
    return { rates: FALLBACK_RATES, isLive: false, updatedAt: 'базовый курс' };
  };
  window.AppAPI.submitOrder = async function (orderData) {
    const response = await fetch('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(orderData)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw new Error(result.error || 'Не удалось отправить заявку. Попробуйте позже.');
    return result;
  };
})(window);
