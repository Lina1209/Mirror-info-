document.addEventListener('DOMContentLoaded', async () => {
    const calcTabs = document.querySelectorAll('#calcTabs .mk-tab');
    const calcChars = document.getElementById('calcChars');
    const presetBtns = document.querySelectorAll('.mk-preset[data-preset]');
    const calcLang = document.getElementById('calcLang');
    const calcFormat = document.getElementById('calcFormat');
    const calcTerm = document.getElementById('calcTerm');
    const calcCurrency = document.getElementById('calcCurrency');
    const calcTotal = document.getElementById('calcTotal');
    const calcRub = document.getElementById('calcRub');
    const calcRows = document.getElementById('calcRows');
    const calcRate = document.getElementById('calcRate');
    const orderEstimate = document.getElementById('orderEstimate');
    const orderChars = document.getElementById('orderChars');

    if (!calcChars || !calcTotal) return;

    const PRICING = {
        minOrderRub: 300,
        charsPerPage: 1800,
        serviceBaseRub: { translate: 450, convert: 220, edit: 280 },
        langMultiplier: { 'ru': 1.0, 'en': 1.0, 'kk': 1.05, 'uk': 1.0, 'de': 1.15, 'fr': 1.15, 'es': 1.15, 'it': 1.15, 'tr': 1.2, 'zh-CN': 1.45, 'ja': 1.5, 'ko': 1.45, 'ar': 1.5, 'he': 1.45 },
        formatMultiplier: { text: 1.0, document: 1.2, scan: 1.35 },
        termMultiplier: { normal: 1.0, urgent: 1.4, express: 1.8 },
        currencySymbols: { RUB: '₽', KZT: '₸', USD: '$', EUR: '€', BYN: 'Br', UAH: '₴', GBP: '£', CNY: '¥', TRY: '₺' }
    };

    let activeService = 'translate';
    let exchangeRates = { RUB: 1, KZT: 5.2, USD: 0.011, EUR: 0.010, BYN: 0.035, UAH: 0.45, GBP: 0.0085, CNY: 0.078, TRY: 0.37 };
    let rateInfoText = 'Ориентировочный курс к RUB';

    if (window.AppAPI && typeof window.AppAPI.getExchangeRates === 'function') {
        try {
            const rateData = await window.AppAPI.getExchangeRates();
            if (rateData && rateData.rates) {
                exchangeRates = { ...exchangeRates, ...rateData.rates };
                rateInfoText = rateData.isLive ? `Актуальный курс на ${rateData.updatedAt}` : 'Базовый расчётный курс к RUB';
            }
        } catch (e) {}
    }

    function formatMoney(amount, currencyCode) {
        const symbol = PRICING.currencySymbols[currencyCode] || currencyCode;
        const decimals = (currencyCode === 'RUB' || currencyCode === 'KZT') ? 0 : 2;
        return `${amount.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${symbol}`;
    }

    function recalculate() {
        let chars = parseInt(calcChars.value, 10);
        if (isNaN(chars) || chars < 100) chars = 100;
        const pages = chars / PRICING.charsPerPage;
        const baseRate = PRICING.serviceBaseRub[activeService] || 450;
        const langK = PRICING.langMultiplier[calcLang.value] || 1.0;
        const formatK = PRICING.formatMultiplier[calcFormat.value] || 1.0;
        const termK = PRICING.termMultiplier[calcTerm.value] || 1.0;

        const rawRub = pages * baseRate * langK * formatK * termK;
        const totalRub = Math.max(PRICING.minOrderRub, Math.round(rawRub));
        const currencyCode = calcCurrency.value;
        const rate = exchangeRates[currencyCode] || 1;
        const totalInCurrency = currencyCode === 'RUB' ? totalRub : totalRub * rate;

        const formattedTotal = formatMoney(totalInCurrency, currencyCode);
        const formattedRub = formatMoney(totalRub, 'RUB');

        calcTotal.textContent = formattedTotal;
        if (calcRub) {
            calcRub.textContent = currencyCode === 'RUB' ? 'Основная расчётная валюта — RUB' : `В рублях: ${formattedRub}`;
        }
        if (calcRate) {
            calcRate.textContent = currencyCode === 'RUB' ? '1 стандартная страница = 1 800 символов.' : `1 ${currencyCode} ≈ ${(1 / rate).toFixed(2)} RUB · ${rateInfoText}`;
        }
        if (orderEstimate) {
            orderEstimate.textContent = currencyCode === 'RUB' ? formattedTotal : `${formattedTotal} (${formattedRub})`;
        }
        if (orderChars) orderChars.value = chars;

        presetBtns.forEach(btn => btn.classList.toggle('is-active', parseInt(btn.dataset.preset, 10) === chars));
    }

    calcTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            calcTabs.forEach(t => t.classList.remove('is-active'));
            tab.classList.add('is-active');
            activeService = tab.dataset.service || 'translate';
            recalculate();
        });
    });

    presetBtns.forEach(btn => btn.addEventListener('click', () => { calcChars.value = btn.dataset.preset; recalculate(); }));
    calcChars.addEventListener('input', recalculate);
    [calcLang, calcFormat, calcTerm, calcCurrency].forEach(el => el && el.addEventListener('change', recalculate));
    recalculate();
});