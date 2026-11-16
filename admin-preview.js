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
      ["Администратор","Senior admin","8","Активен"],
      ["Специалист 1","Order admin","5","Активен"],
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
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = "block";
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.style.display = "none";
  }, 2500);
}

function makeButton(label, action) {
  const button = document.createElement("button");
  button.className = "btn";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", action);
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

function openDetails(title, fields, relatedName) {
  if (!detail) return;

  $("detailTitle").textContent = title;

  const grid = $("detailGrid");
  grid.replaceChildren();

  fields.forEach(([label,value]) => {
    const field = document.createElement("div");
    field.className = "field";

    const small = document.createElement("small");
    small.textContent = label;

    const strong = document.createElement("strong");
    strong.textContent = value;

    field.append(small,strong);
    grid.appendChild(field);
  });

  const note = $("detailComment");
  note.replaceChildren();

  const description = document.createElement("p");
  description.textContent = "Демонстрационная карточка. Данные не сохраняются.";
  note.appendChild(description);

  if (relatedName) {
    const related = demoOrders.find(order =>
      order.name === relatedName
    );

    if (related) {
      note.appendChild(makeButton(
        "Открыть связанную заявку " + related.id,
        () => openOrder(related)
      ));
    }
  }

  note.appendChild(makeButton(
    "Отметить как просмотренное",
    () => showToast("Запись просмотрена в демонстрационном режиме.")
  ));

  note.appendChild(makeButton(
    "Закрыть карточку",
    closeOrder
  ));

  detail.classList.add("open");
}

function openOrder(order) {
  openDetails("Заявка " + order.id,[
    ["Номер заявки",order.id],
    ["Клиент",order.name],
    ["Электронная почта",order.email],
    ["Услуга",order.service],
    ["Дата",order.date],
    ["Стоимость",order.amount],
    ["Статус",order.status],
    ["Комментарий",order.comment]
  ],order.name);
}

function closeOrder() {
  detail?.classList.remove("open");
}

function renderOrders() {
  const body = $("ordersBody");
  if (!body) return;

  const query = ($("search")?.value || "").trim().toLowerCase();
  const selectedStatus = $("statusFilter")?.value || "";

  const filtered = demoOrders.filter(order => {
    const matchesText = [
      order.id,order.name,order.email,order.service
    ].some(value => value.toLowerCase().includes(query));

    const matchesStatus = !selectedStatus ||
      order.status === selectedStatus;

    const matchesTab = activeTab === "all" ||
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
      cell.textContent = value;

      if (index === 0) {
        const span = document.createElement("span");
        span.className = "id";
        span.textContent = value;
        cell.replaceChildren(span);
      }

      row.appendChild(cell);
    });

    const cell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "status " + statusClass(order.status);
    badge.textContent = order.status;
    cell.appendChild(badge);
    row.appendChild(cell);

    row.addEventListener("click",() => openOrder(order));
    body.appendChild(row);
  });

  if ($("resultCount")) {
    $("resultCount").textContent =
      `Показано ${filtered.length} из ${demoOrders.length}`;
  }
}

function renderDemoSection(view) {
  const data = demoData[view];
  if (!data) return;

  let section = $("otherSection");

  if (!section) {
    section = document.createElement("section");
    section.id = "otherSection";
    section.className = "panel";
    main.appendChild(section);
  }

  section.replaceChildren();

  const heading = document.createElement("div");
  heading.className = "panel-head";

  const title = document.createElement("h2");
  title.textContent = data.title;
  heading.appendChild(title);
  section.appendChild(heading);

  const note = document.createElement("p");
  note.style.color = "#748096";
  note.textContent =
    "Нажмите на любую строку, чтобы открыть подробную карточку.";
  section.appendChild(note);

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  data.columns.forEach(column => {
    const th = document.createElement("th");
    th.textContent = column;
    headRow.appendChild(th);
  });

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  data.rows.forEach(values => {
    const row = document.createElement("tr");
    row.style.cursor = "pointer";

    values.forEach(value => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });

    row.addEventListener("click",() => {
      const fields = data.columns.map((column,index) =>
        [column,values[index]]
      );

      const relatedName = view === "messages" ||
        view === "payments" || view === "users"
        ? values[0] === "PAY-001" ? "Анна Иванова" :
          values[0] === "PAY-002" ? "Мария Петрова" :
          values[0] === "PAY-003" ? "Елена Смирнова" :
          values[0]
        : null;

      openDetails(
        data.title + " — " + values[0],
        fields,
        relatedName
      );
    });

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  section.appendChild(wrap);
}

function switchView(view) {
  if (!titles[view]) return;

  document.querySelectorAll("[data-view]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.view === view
    );
  });

  sectionName.textContent = titles[view];
  pageTitle.textContent =
    view === "overview" ? "Добро пожаловать!" : titles[view];

  const isOrders = view === "orders" || view === "overview";

  stats.style.display = isOrders ? "grid" : "none";
  ordersPanel.style.display = isOrders ? "block" : "none";

  $("otherSection")?.remove();

  if (demoData[view]) renderDemoSection(view);

  if (isOrders) {
    activeTab = "all";

    document.querySelectorAll(".tabs button").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.filter === "all"
      );
    });

    if ($("search")) $("search").value = "";
    if ($("statusFilter")) $("statusFilter").value = "";

    renderOrders();
  }

  window.scrollTo({top:0,behavior:"smooth"});
}

function setupOwnerMenu() {
  const ownerButton = document.querySelector(".actions .btn:last-child");
  if (!ownerButton) return;

  ownerButton.type = "button";
  ownerButton.setAttribute("aria-expanded","false");

  const menu = document.createElement("div");
  menu.id = "ownerMenu";

  Object.assign(menu.style,{
    display:"none",
    position:"absolute",
    right:"15px",
    top:"65px",
    zIndex:"10",
    background:"#fff",
    border:"1px solid #e7eaf0",
    borderRadius:"12px",
    padding:"8px",
    boxShadow:"0 8px 25px #20263822",
    minWidth:"190px"
  });

  const items = [
    ["Мой профиль",() => switchView("profile")],
    ["Уведомления",() => showToast("У вас 3 демонстрационных уведомления.")],
    ["Настройки",() => switchView("settings")],
    ["Выйти",() => showToast("Выход будет подключён после реализации авторизации.")]
  ];

  items.forEach(([label,action]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;

    Object.assign(button.style,{
      display:"block",
      width:"100%",
      border:"0",
      background:"#fff",
      textAlign:"left",
      padding:"10px",
      borderRadius:"7px",
      cursor:"pointer"
    });

    button.addEventListener("click",() => {
      menu.style.display = "none";
      ownerButton.setAttribute("aria-expanded","false");
      action();
    });

    menu.appendChild(button);
  });

  document.body.appendChild(menu);

  ownerButton.addEventListener("click",event => {
    event.stopPropagation();
    const opening = menu.style.display === "none";
    menu.style.display = opening ? "block" : "none";
    ownerButton.setAttribute("aria-expanded",String(opening));
  });

  document.addEventListener("click",event => {
    if (!menu.contains(event.target) && event.target !== ownerButton) {
      menu.style.display = "none";
      ownerButton.setAttribute("aria-expanded","false");
    }
  });
}

document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click",() => {
    switchView(button.dataset.view);
  });
});

$("search")?.addEventListener("input",renderOrders);
$("statusFilter")?.addEventListener("change",renderOrders);

document.querySelectorAll(".tabs button").forEach(button => {
  button.addEventListener("click",() => {
    activeTab = button.dataset.filter || "all";

    document.querySelectorAll(".tabs button").forEach(item => {
      item.classList.toggle("active",item === button);
    });

    renderOrders();
  });
});

$("closeDetail")?.addEventListener("click",closeOrder);

detail?.addEventListener("click",event => {
  if (event.target === detail) closeOrder();
});

document.addEventListener("keydown",event => {
  if (event.key === "Escape") closeOrder();
});

$("bell")?.addEventListener("click",() => {
  showToast("У вас 3 демонстрационных уведомления.");
});

setupOwnerMenu();
renderOrders();
switchView("overview");
