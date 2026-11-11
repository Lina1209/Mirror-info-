document.addEventListener('DOMContentLoaded', () => {
    const ADMIN_PASSWORD = 'Lina1209';
    const AUTH_KEY = 'mirror_translator_admin_auth';
    const ORDERS_KEY = 'mirror_translator_orders';

    const loginScreen = document.getElementById('adminLoginScreen');
    const dashboard = document.getElementById('adminDashboard');
    const loginForm = document.getElementById('adminLoginForm');
    const passwordInput = document.getElementById('adminPassword');
    const loginError = document.getElementById('adminLoginError');
    const logoutBtn = document.getElementById('adminLogoutBtn');
    const container = document.getElementById('adminOrdersContainer');
    const resetTrialBtn = document.getElementById('resetTrialBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');

    function showDashboard() {
        loginScreen.classList.add('hidden');
        dashboard.classList.remove('hidden');
        logoutBtn.classList.remove('hidden');
        renderOrders();
    }

    if (sessionStorage.getItem(AUTH_KEY) === '1') showDashboard();

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (passwordInput.value === ADMIN_PASSWORD) {
            sessionStorage.setItem(AUTH_KEY, '1');
            showDashboard();
        } else {
            loginError.classList.remove('hidden');
        }
    });

    logoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem(AUTH_KEY);
        location.reload();
    });

    function renderOrders() {
        const orders = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
        if (!orders.length) {
            container.innerHTML = '<div class="mk-card p-6 text-center text-[var(--text-muted)]">Заявок пока нет.</div>';
            return;
        }
        const statuses = ['Новая', 'В работе', 'Выполнена', 'Отменена'];
        container.innerHTML = [...orders].reverse().map(o => `
            <div class="mk-card p-5">
                <div class="flex flex-wrap justify-between items-center gap-2 pb-3 border-b border-[var(--border-color)]">
                    <span class="font-bold text-[var(--primary-color)]">#${o.id} · ${o.name} (${o.email})</span>
                    <div class="flex items-center gap-2">
                        <select class="mk-select !w-auto !py-1 text-sm" data-status="${o.id}">
                            ${statuses.map(s => `<option value="${s}" ${s === (o.status || 'Новая') ? 'selected' : ''}>${s}</option>`).join('')}
                        </select>
                        <button type="button" class="mk-btn mk-btn--ghost !p-2 text-red-600" data-del="${o.id}"><i class="fa-regular fa-trash-can"></i></button>
                    </div>
                </div>
                <p class="mt-3 text-sm"><strong>Услуга:</strong> ${o.service} · <strong>Язык:</strong> ${o.lang} · <strong>Объём:</strong> ${o.chars} симв. · <strong>Сумма:</strong> ${o.estimate}</p>
                ${o.link ? `<p class="mt-1 text-sm"><a href="${o.link}" target="_blank" class="text-[var(--primary-color)] underline">Открыть файл клиента</a></p>` : ''}
                ${o.comment ? `<p class="mt-2 p-2 rounded bg-[var(--surface-alt)] text-sm">${o.comment}</p>` : ''}
            </div>
        `).join('');

        container.querySelectorAll('[data-status]').forEach(sel => {
            sel.addEventListener('change', (e) => {
                const list = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
                const item = list.find(x => x.id === e.target.dataset.status);
                if (item) { item.status = e.target.value; localStorage.setItem(ORDERS_KEY, JSON.stringify(list)); }
            });
        });

        container.querySelectorAll('[data-del]').forEach(btn => {
            btn.addEventListener('click', () => {
                const list = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]').filter(x => x.id !== btn.dataset.del);
                localStorage.setItem(ORDERS_KEY, JSON.stringify(list));
                renderOrders();
            });
        });
    }

    if (resetTrialBtn) resetTrialBtn.addEventListener('click', () => {
        localStorage.setItem('mirror_translator_free_left', '3');
        alert('Лимит бесплатных файлов сброшен (3/3).');
    });

    if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => {
        const orders = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
        if (!orders.length) return alert('Нет заявок для экспорта.');
        const csv = '\uFEFFID;Статус;Имя;Email;Услуга;Язык;Символов;Расчёт\n' +
            orders.map(o => `${o.id};${o.status || 'Новая'};${o.name};${o.email};${o.service};${o.lang};${o.chars};${o.estimate}`).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        a.download = 'orders.csv';
        a.click();
    });
});