// Mirror-info — интерактивный демонстрационный макет.
// Только тестовые данные. Реальная база и API не подключены.
"use strict";

const $ = id => document.getElementById(id);

const demoOrders = [
  {id:"MI-2026-001",name:"Анна Иванова",email:"anna@example.com",service:"Перевод документа",date:"16.11.2026",amount:"4 500 ₽",status:"Новая",comment:"Ожидает подтверждения заявки."},
  {id:"MI-2026-002",name:"Мария Петрова",email:"maria@example.com",service:"Редактирование текста",date:"15.11.2026",amount:"2 800 ₽",status:"В работе",comment:"Заявка передана специалисту."},
  {id:"MI-2026-003",name:"Елена Смирнова",email:"elena@example.com",service:"Конвертация файла",date:"14.11.2026",amount:"1 100 ₽",status:"Выполнена",comment:"Заказ завершён."},
  {id:"MI-2026-004",name:"Ольга Кузнецова",email:"olga@example.com",service:"Перевод документа",date:"13.11.2026",amount:"3 600 ₽",status:"Отменена",comment:"Заявка отменена."},
  {id:"MI-2026-005",name:"Ирина Соколова",email:"irina@example.com",service:"Редактирование текста",date:"12.11.2026",amount:"2 200 ₽",status:"Новая",comment:"Ожидается проверка данных."}
];

const demoData = {
  messages:{
    title:"Сообщения",
    columns:["Клиент","Тема","Дата","Статус"],
    rows:[
      ["Анна Иванова","Вопрос по заявке MI-2026-001","16.11.2026","Новое"],
      ["Мария Петрова","Уточнение по документу","15.11.2026","Отвечено"],
      ["Елена Смирнова","Благодарность","14.11.2026","Закрыто"]
    ]
  },
  payments:{
    title:"Платежи",
    columns:["№ платежа","Клиент","Сумма","Статус"],
    rows:[
      ["PAY-001","Анна Иванова","4 500 ₽","Ожидает оплаты"],
      ["PAY-002","Мария Петрова","2 800 ₽","Оплачен"],
      ["PAY-003","Елена Смирнова","1 100 ₽","Оплачен"]
    ]
  },
  users:{
    title:"Пользователи",
    columns:["Имя","Электронная почта","Регистрация","Статус"],
    rows:[
      ["Анна Иванова","anna@example.com","16.11.2026","Активен"],
      ["Мария Петрова","maria@example.com","15.11.2026","Активен"],
      ["Елена Смирнова","elena@example.com","14.11.2026","Активен"]
    ]
  },
  staff:{
    title:"Сотрудники",
    columns:["Сотрудник","Роль","Назначено заявок","Статус"],
    rows:[
      ["Администратор","Старший администратор","8","Активен"],
      ["Специалист 1","Администратор заказов","5","Активен"],
      ["Поддержка","Support admin","3","Активен"]
    ]
  },
  reports:{
    title:"Отчёты",
    columns:["Показатель","Значение","Период"],
    rows:[
      ["Всего заявок","128","За всё время"],
      ["Новые заявки","3","Сегодня"],
      ["Завершённые","86","За всё время"],
      ["Ожидают оплаты","5","Сейчас"]
    ]
  },
  settings:{
    title:"Настройки",
    columns:["Параметр","Значение"],
    rows:[
      ["Название проекта","Mirror-info"],
      ["Уведомления","Включены в макете"],
      ["Язык интерфейса","Русский"],
      ["Режим","Демонстрационный"]
    ]
  },
  profile:{
    title:"Профиль владельца",
    columns:["Параметр","Информация"],
    rows:[
      ["Роль","Владелец"],
      ["Доступ","Полный"],
      ["Проект","Mirror-info"],
      ["Режим","Демонстрационный"]
    ]
  }
};

const main = document.querySelector("main");
const stats = document.querySelector(".stats");
const ordersPanel = document.querySelector(".panel");
const sectionName = $("sectionName");
const pageTitle = $("pageTitle");
const toast = $("toast");
const detail = $("detail");

let activeTab = "all";

const viewedRecords = new Set();
const orderAssignments = {};

const orderHistory = {
  "MI-2026-001":[
    {text:"Заявка создана",when:"16.11.2026"}
  ]
};

const notificationRecords = [
  {
    key:"order:MI-2026-001",
    title:"📋 Новая заявка",
    description:"Поступила новая заявка от Анны Ивановой.",
    view:"orders"
  },
  {
    key:"message:0",
    title:"✉ Новое сообщение",
    description:"Клиент отправил новое сообщение.",
    view:"messages"
  },
  {
    key:"payment:0",
    title:"₸ Ожидает оплаты",
    description:"Есть платёж, ожидающий оплаты.",
    view:"payments"
  }
];

const titles = {
  overview:"Обзор",
  orders:"Заявки",
  messages:"Сообщения",
  payments:"Платежи",
  users:"Пользователи",
  staff:"Сотрудники",
  reports:"Отчёты",
  settings:"Настройки",
  profile:"Профиль владельца"
};

function showToast(message) {
  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.style.display = "block";

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.style.display = "none";
  },2500);
}

function makeButton(label,action) {
  const button = document.createElement("button");

  button.className = "btn";
  button.type = "button";
  button.textContent = label;

  button.addEventListener("click",action);

  return button;
}

function statusClass(status) {
  return {
    "Новая":"s-new",
    "В работе":"s-work",
    "Выполнена":"s-done",
    "Отменена":"s-cancel"
  }[status] || "";
}

function bellBadge() {
  const bell = $("bell");
  if (!bell) return null;

  let badge =
    bell.querySelector("[data-unread-count]") ||
    bell.querySelector("b");

  if (!badge) {
    badge = document.createElement("b");
    bell.appendChild(badge);
  }

  badge.dataset.unreadCount = "true";
  badge.style.marginLeft = "5px";

  return badge;
}

function updateNotificationCount() {
  const unread = notificationRecords.filter(item =>
    !viewedRecords.has(item.key)
  ).length;

  const badge = bellBadge();

  if (badge) {
    badge.textContent = String(unread);
  }

  const bell = $("bell");

  if (bell) {
    bell.setAttribute(
      "aria-label",
      "Уведомления. Непрочитанных: " + unread
    );

    bell.title = "Непрочитанных уведомлений: " + unread;
  }
}

function markViewed(recordKey,view) {
  if (recordKey) {
    viewedRecords.add(recordKey);
  }

  if (view === "messages" && recordKey) {
    const index = Number(recordKey.split(":")[1]);

    if (demoData.messages.rows[index]) {
      demoData.messages.rows[index][3] = "Просмотрено";
    }
  }

  updateNotificationCount();
  renderNotificationItems();

  
}

function addHistory(orderId,text) {
  if (!orderHistory[orderId]) {
    orderHistory[orderId] = [];
  }

  orderHistory[orderId].push({
    text,
    when:new Date().toLocaleString("ru-RU")
  });
  }
function openDetails(title,fields,relatedName,recordKey,order,view) {
  if (!detail) return;

  const titleElement = $("detailTitle");
  const grid = $("detailGrid");
  const note = $("detailComment");

  if (!titleElement || !grid || !note) return;

  titleElement.textContent = title;
  grid.replaceChildren();

  fields.forEach(([label,value]) => {
    const field = document.createElement("div");
    field.className = "field";

    const small = document.createElement("small");
    small.textContent = label;

    const strong = document.createElement("strong");
    strong.textContent = value == null ? "—" : String(value);

    field.append(small,strong);
    grid.appendChild(field);
  });

  note.replaceChildren();

  const description = document.createElement("p");

  description.textContent = order
    ? order.comment
    : "Демонстрационная карточка. Изменения существуют только до перезагрузки страницы.";

  note.appendChild(description);

  if (order) {
    const assignment = document.createElement("p");

    assignment.textContent =
      "Ответственный: " +
      (orderAssignments[order.id] || "Не назначен");

    note.appendChild(assignment);

    const historyTitle = document.createElement("h3");
    historyTitle.textContent = "История действий";
    note.appendChild(historyTitle);

    const historyList = document.createElement("ul");

    (orderHistory[order.id] || []).forEach(item => {
      const li = document.createElement("li");

      li.textContent = item.text + " — " + item.when;

      historyList.appendChild(li);
    });

    note.appendChild(historyList);

    if (order.status === "Новая") {
      note.appendChild(
        makeButton("Принять в работу",() => acceptOrder(order))
      );
    }
  }

  if (relatedName) {
    const related = demoOrders.find(item =>
      item.name === relatedName
    );

    if (related) {
      note.appendChild(
        makeButton(
          "Открыть связанную заявку " + related.id,
          () => openOrder(related)
        )
      );
    }
  }

  if (recordKey) {
    const alreadyViewed = viewedRecords.has(recordKey);

    note.appendChild(
      makeButton(
        alreadyViewed
          ? "Уже просмотрено"
          : "Отметить как просмотренное",
        () => {
          markViewed(recordKey,view);

          openDetails(
            title,
            fields,
            relatedName,
            recordKey,
            order,
            view
          );
        }
      )
    );
  }

  note.appendChild(
    makeButton("Закрыть карточку",closeOrder)
  );

  detail.classList.add("open");
}

function acceptOrder(order) {
  if (order.status !== "Новая") {
    showToast("Эта заявка уже принята или обработана.");
    return;
  }

  order.status = "В работе";

  orderAssignments[order.id] = "Владелец (демо)";

  addHistory(
    order.id,
    "Принято в работу владельцем (демо)"
  );

  renderOrders();
  openOrder(order);

  showToast("Заявка принята в работу.");
}

function openOrder(order) {
  openDetails(
    "Заявка " + order.id,
    [
      ["Номер заявки",order.id],
      ["Клиент",order.name],
      ["Электронная почта",order.email],
      ["Услуга",order.service],
      ["Дата",order.date],
      ["Стоимость",order.amount],
      ["Статус",order.status],
      ["Комментарий",order.comment]
    ],
    null,
    "order:" + order.id,
    order,
    "orders"
  );
}

function closeOrder() {
  if (detail) {
    detail.classList.remove("open");
  }
}

function renderOrders() {
  const body = $("ordersBody");
  if (!body) return;

  const query = ($("search")?.value || "")
    .trim()
    .toLowerCase();

  const selectedStatus = $("statusFilter")?.value || "";

  const filtered = demoOrders.filter(order => {
    const matchesText = [
      order.id,
      order.name,
      order.email,
      order.service
    ].some(value =>
      value.toLowerCase().includes(query)
    );

    const matchesStatus =
      !selectedStatus ||
      order.status === selectedStatus;

    const matchesTab =
      activeTab === "all" ||
      order.status === activeTab;

    return matchesText && matchesStatus && matchesTab;
  });

  body.replaceChildren();

  filtered.forEach(order => {
    const row = document.createElement("tr");

    [
      order.id,
      order.name,
      order.service,
      order.date,
      order.amount
    ].forEach((value,index) => {
      const cell = document.createElement("td");

      if (index === 0) {
        const span = document.createElement("span");

        span.className = "id";
        span.textContent = value;

        cell.appendChild(span);
      } else {
        cell.textContent = value;
      }

      row.appendChild(cell);
    });

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");

    badge.className =
      "status " + statusClass(order.status);

    badge.textContent = order.status;

    statusCell.appendChild(badge);
    row.appendChild(statusCell);

    row.style.cursor = "pointer";

    row.addEventListener("click",() => {
      openOrder(order);
    });

    body.appendChild(row);
  });

  if ($("resultCount")) {
    $("resultCount").textContent =
      "Показано " + filtered.length +
      " из " + demoOrders.length;
  }
}

function getRelatedName(view,values) {
  if (view === "messages" || view === "users") {
    return values[0];
  }

  if (view === "payments") {
    return values[1];
  }

  return null;
}

function getRecordKey(view,index) {
  if (view === "messages") {
    return "message:" + index;
  }

  if (view === "payments") {
    return "payment:" + index;
  }

  return null;
    }
function renderDemoSection(view) {
  const container = $("sectionContent");
  if (!container) return;

  const section = demoData[view];

  if (!section) {
    container.innerHTML = "<p>Раздел пока не настроен.</p>";
    return;
  }

  let html = '<div class="section-table">';

  if (Array.isArray(section.rows) && section.rows.length) {
    html += '<div class="table-wrap"><table><thead><tr>';

    section.columns.forEach(header => {
      html += "<th>" + header + "</th>";
    });

    html += "</tr></thead><tbody>";

    section.rows.forEach((row, index) => {
      html += '<tr data-row="' + index + '">';

      row.forEach(value => {
        html += "<td>" + value + "</td>";
      });

      html += "</tr>";
    });

    html += "</tbody></table></div>";
  } else {
    html += "<p>В этом разделе пока нет записей.</p>";
  }

  html += "</div>";
  container.innerHTML = html;

  container.querySelectorAll("tbody tr").forEach((row, index) => {
    row.style.cursor = "pointer";

    row.addEventListener("click", () => {
      const record = section.rows[index];
      openDetails(
        section.headers[0] || "Запись",
        section.headers.map((header, i) => [
          header,
          record[i] || "—"
        ]),
        null,
        getRecordKey(view, index),
        null,
        view
      );
    });
  });
}

function switchView(view) {
  const knownViews = [
    "overview",
    "orders",
    "messages",
    "payments",
    "users",
    "staff",
    "reports",
    "settings",
    "profile"
  ];

  if (!knownViews.includes(view)) {
    view = "overview";
  }

  document.querySelectorAll("[data-view]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.view === view
    );
  });

  document.querySelectorAll(".view-panel").forEach(panel => {
    panel.hidden = panel.id !== view + "View";
  });

  const title = $("pageTitle");

  if (title) {
    title.textContent = titles[view] || "Обзор";
  }

  const breadcrumb = $("breadcrumb");

  if (breadcrumb) {
    breadcrumb.textContent = titles[view] || "Обзор";
  }

  if (view === "orders") {
    renderOrders();
  } else if (view !== "overview") {
    renderDemoSection(view);
  }

  document.querySelectorAll("[data-view]").forEach(button => {
    button.onclick = () => switchView(button.dataset.view);
  });
}

function setupOwnerMenu() {
  const button = $("ownerMenu");
  const menu = $("ownerDropdown");

  if (!button || !menu) return;

  button.addEventListener("click", event => {
    event.stopPropagation();

    menu.hidden = !menu.hidden;
  });

  document.addEventListener("click", event => {
    if (!menu.contains(event.target) && event.target !== button) {
      menu.hidden = true;
    }
  });
}

function renderNotificationItems() {
  const list = $("notificationsList");

  if (!list) return;

  list.innerHTML = "";

  notificationRecords.forEach((record, index) => {
    const item = document.createElement("div");

    item.className = "notification-item";
    item.style.padding = "12px";
    item.style.borderBottom = "1px solid #e5e7eb";

    const text = document.createElement("div");
    text.textContent = record.title + ": " + record.description;

    const button = makeButton("Открыть");

    button.addEventListener("click", () => {
      markViewed(record.key, record.view);

      if (record.view) {
        switchView(record.view);
      }

      if (record.related) {
        const order = demoOrders.find(
          item => item.id === record.related
        );

        if (order) {
          openOrder(order.id);
        }
      }

      renderNotificationItems();
    });

    item.appendChild(text);
    item.appendChild(button);

    list.appendChild(item);
  });

  if (!notificationRecords.length) {
    list.textContent = "Новых уведомлений нет.";
  }
}

function setupNotifications() {
  const bell = $("bell");

  if (!bell) return;

  const panel = document.createElement("div");
  panel.id = "notificationsPanel";

  Object.assign(panel.style, {
    display: "none",
    position: "absolute",
    right: "12px",
    top: "60px",
    zIndex: "1000",
    width: "min(360px, calc(100vw - 24px))",
    maxHeight: "420px",
    overflowY: "auto",
    background: "#fff",
    border: "1px solid #ddd",
    borderRadius: "12px",
    padding: "12px",
    boxShadow: "0 8px 24px rgba(0,0,0,.15)"
  });

  const heading = document.createElement("h3");
  heading.textContent = "Уведомления";

  const close = makeButton("Закрыть");
  close.addEventListener("click", () => {
    panel.style.display = "none";
  });

  const list = document.createElement("div");
  list.id = "notificationsList";

  panel.appendChild(heading);
  panel.appendChild(close);
  panel.appendChild(list);

  document.body.appendChild(panel);

  bell.addEventListener("click", event => {
    event.stopPropagation();

    const isVisible = panel.style.display === "block";

    panel.style.display = isVisible ? "none" : "block";

    if (!isVisible) {
      renderNotificationItems();
    }
  });

  panel.addEventListener("click", event => {
    event.stopPropagation();
  });

  document.addEventListener("click", event => {
    if (!panel.contains(event.target) && event.target !== bell) {
      panel.style.display = "none";
    }
  });

  updateNotificationCount();
}

document.addEventListener("DOMContentLoaded", () => {
  setupNotifications();
  setupOwnerMenu();
  renderOrders();
  switchView("overview");
});
