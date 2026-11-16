// Mirror-info — демонстрационная панель управления.
// Только тестовые данные. Реальная база и API не подключены.

"use strict";

const demoOrders = [
  {
    id: "MI-2026-001",
    name: "Анна Иванова",
    email: "anna@example.com",
    service: "Перевод документа",
    date: "16.11.2026",
    amount: "4 500 ₽",
    status: "Новая",
    comment: "Клиент ожидает подтверждения заявки."
  },
  {
    id: "MI-2026-002",
    name: "Мария Петрова",
    email: "maria@example.com",
    service: "Редактирование текста",
    date: "15.11.2026",
    amount: "2 800 ₽",
    status: "В работе",
    comment: "Заявка передана специалисту."
  },
  {
    id: "MI-2026-003",
    name: "Елена Смирнова",
    email: "elena@example.com",
    service: "Конвертация файла",
    date: "14.11.2026",
    amount: "1 100 ₽",
    status: "Выполнена",
    comment: "Демонстрационный заказ завершён."
  },
  {
    id: "MI-2026-004",
    name: "Ольга Кузнецова",
    email: "olga@example.com",
    service: "Перевод документа",
    date: "13.11.2026",
    amount: "3 600 ₽",
    status: "Отменена",
    comment: "Демонстрационная отменённая заявка."
  },
  {
    id: "MI-2026-005",
    name: "Ирина Соколова",
    email: "irina@example.com",
    service: "Редактирование текста",
    date: "12.11.2026",
    amount: "2 200 ₽",
    status: "Новая",
    comment: "Ожидается проверка данных."
  }
];

const ordersBody = document.getElementById("ordersBody");
const searchInput = document.getElementById("search");
const statusFilter = document.getElementById("statusFilter");
const resultCount = document.getElementById("resultCount");
const detail = document.getElementById("detail");
const detailTitle = document.getElementById("detailTitle");
const detailGrid = document.getElementById("detailGrid");
const detailComment = document.getElementById("detailComment");
const toast = document.getElementById("toast");

let activeTab = "all";

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function getStatusClass(status) {
  const classes = {
    "Новая": "s-new",
    "В работе": "s-work",
    "Выполнена": "s-done",
    "Отменена": "s-cancel"
  };

  return classes[status] || "";
}

function renderOrders() {
  if (!ordersBody) return;

  const query = (searchInput?.value || "").trim().toLowerCase();
  const selectedStatus = statusFilter?.value || "";

  const filtered = demoOrders.filter(order => {
    const matchesQuery = [
      order.id,
      order.name,
      order.email,
      order.service
    ].some(value => value.toLowerCase().includes(query));

    const matchesStatus =
      !selectedStatus || order.status === selectedStatus;

    const matchesTab =
      activeTab === "all" || order.status === activeTab;

    return matchesQuery && matchesStatus && matchesTab;
  });

  ordersBody.innerHTML = "";

  filtered.forEach(order => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td><span class="id">${escapeHTML(order.id)}</span></td>
      <td>${escapeHTML(order.name)}</td>
      <td>${escapeHTML(order.service)}</td>
      <td>${escapeHTML(order.date)}</td>
      <td>${escapeHTML(order.amount)}</td>
      <td>
        <span class="status ${getStatusClass(order.status)}">
          ${escapeHTML(order.status)}
        </span>
      </td>
    `;

    row.addEventListener("click", () => openOrder(order.id));
    ordersBody.appendChild(row);
  });

  if (resultCount) {
    resultCount.textContent =
      `Показано ${filtered.length} из ${demoOrders.length}`;
  }
}

function openOrder(orderId) {
  const order = demoOrders.find(item => item.id === orderId);
  if (!order || !detail) return;

  detailTitle.textContent = `Заявка ${order.id}`;

  const fields = [
    ["Клиент", order.name],
    ["Электронная почта", order.email],
    ["Услуга", order.service],
    ["Дата", order.date],
    ["Стоимость", order.amount],
    ["Статус", order.status]
  ];

  detailGrid.innerHTML = "";

  fields.forEach(([label, value]) => {
    const field = document.createElement("div");
    field.className = "field";

    const small = document.createElement("small");
    small.textContent = label;

    const strong = document.createElement("strong");
    strong.textContent = value;

    field.append(small, strong);
    detailGrid.appendChild(field);
  });

  detailComment.textContent = order.comment;
  detail.classList.add("open");
}

function closeOrder() {
  detail?.classList.remove("open");
}

function showToast(message) {
  if (!toast) return;

  toast.textContent = message;
  toast.style.display = "block";

  window.clearTimeout(showToast.timer);

  showToast.timer = window.setTimeout(() => {
    toast.style.display = "none";
  }, 2500);
}

searchInput?.addEventListener("input", renderOrders);
statusFilter?.addEventListener("change", renderOrders);

document.querySelectorAll(".tabs button").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(item => {
      item.classList.remove("active");
    });

    button.classList.add("active");
    activeTab = button.dataset.filter || "all";
    renderOrders();
  });
});

document.getElementById("closeDetail")
  ?.addEventListener("click", closeOrder);

detail?.addEventListener("click", event => {
  if (event.target === detail) closeOrder();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeOrder();
});

document.getElementById("bell")
  ?.addEventListener("click", () => {
    showToast("Здесь будет центр уведомлений.");
  });

document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach(item => {
      item.classList.remove("active");
    });

    button.classList.add("active");

    const view = button.dataset.view;
    const titles = {
      overview: "Обзор",
      orders: "Заявки",
      messages: "Сообщения",
      payments: "Платежи",
      users: "Пользователи",
      staff: "Сотрудники",
      reports: "Отчёты",
      settings: "Настройки",
      profile: "Профиль владельца"
    };

    const title = titles[view] || "Раздел";

    document.getElementById("sectionName").textContent = title;
    document.getElementById("pageTitle").textContent = title;

    if (view !== "overview" && view !== "orders") {
      showToast(`Раздел «${title}» будет подключён на следующем этапе.`);
    }
  });
});

renderOrders();
