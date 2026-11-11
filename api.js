(function (window) {
    'use strict';
    const CONFIG = {
        telegramBotToken: '',
        telegramChatId: '',
        orderWebhookUrl: '',
        baseCurrency: 'RUB',
        fallbackRates: { RUB: 1, KZT: 5.2, USD: 0.011, EUR: 0.010, BYN: 0.035, UAH: 0.45, GBP: 0.0085, CNY: 0.078, TRY: 0.37 }
    };
    const AppAPI = {
        config: CONFIG,
        async translate(text, sourceLang = 'auto', targetLang = 'ru') {
            if (!text || !text.trim()) return text;
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Сервис перевода временно недоступен.');
            const data = await res.json();
            // Google Translate free endpoint returns [[ ["translated", "original", ...], ... ], ...]
            if (Array.isArray(data) && Array.isArray(data[0])) {
                return data[0].map(item => (item && item[0]) || '').join('');
            }
            return text;
        },
        async getExchangeRates() {
            try {
                const res = await fetch('https://open.er-api.com/v6/latest/RUB');
                const data = await res.json();
                if (data && data.result === 'success' && data.rates) {
                    return { rates: data.rates, isLive: true, updatedAt: new Date().toLocaleDateString('ru-RU') };
                }
            } catch (e) {}
            return { rates: CONFIG.fallbackRates, isLive: false, updatedAt: 'базовый курс' };
        },
        async submitOrder(orderData) {
            const savedOrders = JSON.parse(localStorage.getItem('mirror_translator_orders') || '[]');
            savedOrders.push({ id: 'ORD-' + Date.now().toString().slice(-6), date: new Date().toISOString(), status: 'Новая', ...orderData });
            localStorage.setItem('mirror_translator_orders', JSON.stringify(savedOrders));
            return { ok: true };
        }
    };
    window.AppAPI = AppAPI;
})(window);