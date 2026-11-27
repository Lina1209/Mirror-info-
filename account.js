        document.addEventListener('DOMContentLoaded', () => {
            const trialSaved = localStorage.getItem('mirror_translator_free_left');
            const trialValue = trialSaved === null ? 3 : Number.parseInt(trialSaved, 10);
            document.getElementById('accTrialLeft').textContent =
                Number.isFinite(trialValue) ? Math.max(0, trialValue) : '—';

            const ordersList = document.getElementById('ordersList');
            const clearBtn = document.getElementById('clearHistoryBtn');

            function render() {
                let orders = [];
                try {
                    const stored = JSON.parse(localStorage.getItem('mirror_translator_orders') || '[]');
                    if (Array.isArray(stored)) orders = stored;
                } catch (_) {
                    orders = [];
                }

                document.getElementById('accOrdersCount').textContent = String(orders.length);
                ordersList.replaceChildren();

                if (!orders.length) {
                    clearBtn.classList.add('hidden');
                    const empty = document.createElement('p');
                    empty.className = 'text-sm text-[var(--text-muted)]';
                    empty.textContent = 'Локальных записей пока нет. Новые заявки можно будет просматривать здесь после подключения безопасного входа.';
                    ordersList.appendChild(empty);
                    return;
                }

                clearBtn.classList.remove('hidden');
                for (const order of [...orders].reverse()) {
                    const card = document.createElement('article');
                    card.className = 'p-4 rounded-xl border border-[var(--border-color)] bg-[var(--surface-alt)]';

                    const header = document.createElement('div');
                    header.className = 'flex justify-between gap-3 font-bold text-sm';
                    const id = document.createElement('span');
                    id.className = 'text-[var(--primary-color)]';
                    id.textContent = '#' + String(order?.id ?? '—');
                    const status = document.createElement('span');
                    status.className = 'mk-pill';
                    status.textContent = String(order?.status || 'Новая');
                    header.append(id, status);

                    const service = document.createElement('p');
                    service.className = 'mt-1 font-semibold';
                    service.textContent = String(order?.service || 'Услуга не указана') +
                        (order?.lang ? ' (' + String(order.lang) + ')' : '');

                    const details = document.createElement('p');
                    details.className = 'text-sm text-[var(--text-muted)]';
                    details.textContent = 'Объём: ' + String(order?.chars ?? '—') +
                        ' симв. · Оценка: ' + String(order?.estimate ?? '—');

                    card.append(header, service, details);
                    ordersList.appendChild(card);
                }
            }

            clearBtn.addEventListener('click', () => {
                localStorage.removeItem('mirror_translator_orders');
                render();
            });
            render();
        });
