import {
  localDateKey, amountInKopecks, formatAmount, amountForInput,
  periodBounds, summarize, openLedger, readLedger, writeRecord,
} from "./ledger.js";

const byId = (id) => document.getElementById(id);
const form = byId("expense-form");
const operationDialog = byId("operation-dialog");
const directoryDialog = byId("directory-dialog");
const directoryForm = byId("directory-form");
const amount = byId("amount");
const account = byId("account");
const targetAccount = byId("target-account");
const date = byId("expense-date");
const category = byId("category");
const scope = byId("scope");
const save = byId("save-expense");
const message = byId("form-message");
const editorMessage = byId("editor-message");
const pageMessage = byId("page-message");
const download = byId("download");
const fullDay = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" });
const datedDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const mobile = matchMedia("(max-width: 820px)");
const typeNames = { expense: "Расход", income: "Доход", transfer: "Перевод" };
const directoryNames = {
  accounts: ["Новый счёт", "Редактирование счёта"],
  groups: ["Новая группа", "Редактирование группы"],
  categories: ["Новая категория", "Редактирование категории"],
};

let snapshot;
let period = "week";
let operationType = "expense";
let editingOperation;
let directoryStore;
let editingRecord;
const database = openLedger().catch((error) => {
  showPageMessage(error.message || "Не удалось открыть данные на устройстве.", false);
  return null;
});

function showPageMessage(text, success) {
  pageMessage.textContent = text;
  pageMessage.classList.toggle("success", success);
  pageMessage.hidden = !text;
}

function showView(view) {
  byId("journal").hidden = view !== "journal";
  byId("directory").hidden = view !== "accounts";
  byId("show-journal").setAttribute("aria-current", view === "journal" ? "page" : "false");
  byId("show-accounts").setAttribute("aria-current", view === "accounts" ? "page" : "false");
  showPageMessage("", true);
  window.scrollTo(0, 0);
  if (snapshot) render();
}

byId("show-journal").addEventListener("click", () => showView("journal"));
byId("show-accounts").addEventListener("click", () => showView("accounts"));
byId("show-expense").addEventListener("click", () => openOperation());

for (const dialog of [operationDialog, directoryDialog]) {
  const submit = dialog.querySelector("[type=submit]");
  dialog.querySelector("[data-close]").addEventListener("click", () => {
    if (!submit.disabled) dialog.close();
  });
  dialog.addEventListener("cancel", (event) => {
    if (submit.disabled) event.preventDefault();
  });
}

function findAccount(id) {
  return snapshot.accounts.find((item) => item.id === id);
}

function colorDot(id, color) {
  byId(id).dataset.color = color ?? "mint";
}

function populate(select, items, value, blankLabel) {
  const options = items.map(({ name, id }) => new Option(name, id));
  if (blankLabel) options.unshift(new Option(blankLabel, ""));
  select.replaceChildren(...options);
  if (options.some((option) => option.value === value)) select.value = value;
}

function updateTargets(value) {
  populate(targetAccount, snapshot.accounts.filter((item) => item.id !== account.value), value, "Выберите счёт");
  colorDot("target-dot", findAccount(targetAccount.value)?.color);
}

function setOperationType(type, categoryId, targetId) {
  operationType = type;
  const isTransfer = type === "transfer";
  byId("category-field").hidden = isTransfer;
  byId("target-field").hidden = !isTransfer;
  byId("account-label").textContent = isTransfer ? "Откуда" : "Счёт";
  for (const button of byId("operation-types").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.type === type));
  }
  populate(category, snapshot.categories.filter((item) => item.type === type), categoryId, "Без категории");
  if (isTransfer) updateTargets(targetId);
  save.textContent = editingOperation ? "Сохранить изменения" : {
    expense: "Сохранить расход",
    income: "Сохранить доход",
    transfer: "Сохранить перевод",
  }[type];
}

function openOperation(record) {
  if (!snapshot) return;
  editingOperation = record;
  byId("composer-title").textContent = record ? "Редактирование операции" : "Новая операция";
  amount.value = record ? amountForInput(record.amountKopecks) : "";
  date.value = record?.date ?? localDateKey();
  populate(account, snapshot.accounts, record?.accountId ?? "card");
  colorDot("account-dot", findAccount(account.value)?.color);
  setOperationType(record?.type ?? "expense", record?.categoryId, record?.targetAccountId);
  alignAmount();
  clearMessage();
  if (!operationDialog.open) operationDialog.showModal();
}

account.addEventListener("change", () => {
  colorDot("account-dot", findAccount(account.value)?.color);
  if (operationType === "transfer") updateTargets(targetAccount.value);
});
targetAccount.addEventListener("change", () => colorDot("target-dot", findAccount(targetAccount.value)?.color));
byId("operation-types").addEventListener("click", (event) => {
  const type = event.target.closest("button")?.dataset.type;
  if (type && type !== operationType && !save.disabled) {
    setOperationType(type);
    clearMessage();
  }
});

function alignAmount() {
  const length = amount.value.length;
  amount.style.setProperty("--digits", Math.max(1, Math.min(length, 16)));
  amount.dataset.compact = length > 9;
}

function clearMessage() {
  message.textContent = "";
  message.classList.remove("success");
  amount.removeAttribute("aria-invalid");
}

function normalizeAmount(value) {
  return value.replace(/\s/g, "").replace(".", ",").replace(/^−/, "-");
}

amount.addEventListener("input", () => {
  const value = normalizeAmount(amount.value);
  if (value !== amount.value) amount.value = value;
  alignAmount();
  clearMessage();
});

byId("keypad").addEventListener("click", (event) => {
  const key = event.target.closest("button")?.dataset.key;
  if (!key || save.disabled) return;

  if (key === "backspace") {
    amount.value = amount.value.slice(0, -1);
  } else if (key === ",") {
    if (amount.value.includes(",")) return;
    amount.value = (amount.value || "0") + ",";
  } else {
    const next = (amount.value === "0" ? "" : amount.value) + key;
    if (!/^\d{1,12}(,\d{0,2})?$/.test(next)) return;
    amount.value = next;
  }
  alignAmount();
  clearMessage();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!snapshot || save.disabled) return;
  clearMessage();
  const amountKopecks = amountInKopecks(amount.value);
  if (amountKopecks === null) {
    amount.setAttribute("aria-invalid", "true");
    message.textContent = "Введите сумму больше нуля, до двух знаков после запятой.";
    return;
  }
  if (!date.value || !date.validity.valid) {
    message.textContent = "Выберите дату.";
    return;
  }
  const type = operationType;
  if (type === "transfer" && (!targetAccount.value || targetAccount.value === account.value)) {
    message.textContent = "Выберите другой счёт для зачисления.";
    return;
  }

  const previous = editingOperation;
  const operation = {
    id: previous?.id ?? crypto.randomUUID(),
    type,
    amountKopecks,
    accountId: account.value,
    categoryId: type === "transfer" ? null : category.value || null,
    date: date.value,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
  };
  if (type === "transfer") operation.targetAccountId = targetAccount.value;

  save.disabled = true;
  try {
    await writeRecord(await database, "operations", operation, previous ? previous.revision ?? 0 : undefined);
    await refresh();
    const notice = `Сохранено · ${formatAmount(amountKopecks)} ₽`;
    if (previous || !mobile.matches) {
      operationDialog.close();
      showPageMessage(notice, true);
    } else {
      openOperation();
      message.classList.add("success");
      message.textContent = notice;
    }
  } catch (error) {
    message.textContent = error?.message || "Не удалось сохранить операцию.";
    refresh();
  } finally {
    save.disabled = false;
  }
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function row(title, subtitle, symbol, color, value, amountClass, action) {
  const entry = element("li", "entry");
  const button = element("button", "entry-action");
  button.type = "button";
  const icon = element("span", "entry-icon", symbol);
  icon.dataset.color = color;
  icon.setAttribute("aria-hidden", "true");
  const details = element("span", "entry-detail");
  details.append(element("strong", "", title));
  if (subtitle) details.append(element("span", "", subtitle));
  button.append(icon, details, element("strong", `entry-amount ${amountClass}`, value));
  button.addEventListener("click", action);
  entry.append(button);
  return entry;
}

function block(title, rows) {
  const group = element("section", "entry-group");
  const list = element("ul", "entry-list");
  list.append(...rows);
  group.append(element("h3", "entry-date", title), list);
  return group;
}

const money = (value) => `${formatAmount(value)} ₽`;
const signedMoney = (value) => value > 0n ? "+" + money(value) : money(value);

function renderOperation(operation, selected) {
  const from = findAccount(operation.accountId);
  const categoryInfo = snapshot.categories.find((item) => item.id === operation.categoryId);
  const { type, date, amountKopecks, targetAccountId } = operation;
  let value = BigInt(amountKopecks);
  let title = categoryInfo?.name ?? "Без категории";
  let subtitle = `${typeNames[type]} · ${from.name}`;
  let symbol = type === "expense" ? "↘" : "↗";
  let amountClass = type === "expense" ? "" : "positive";
  let unsigned = false;

  if (type === "expense") value = -value;
  if (type === "transfer") {
    title = "Перевод";
    subtitle = `${from.name} → ${findAccount(targetAccountId).name}`;
    symbol = "⇄";
    const outgoing = selected.has(operation.accountId);
    const incoming = selected.has(targetAccountId);
    unsigned = outgoing && incoming;
    if (outgoing && !incoming) value = -value;
    amountClass = !outgoing && incoming ? "positive" : "";
  }
  if (date > localDateKey()) subtitle += " · Будущая дата";
  return row(title, subtitle, symbol, categoryInfo?.color ?? from.color,
    unsigned ? money(value) : signedMoney(value), amountClass, () => openOperation(operation));
}

function updateScope() {
  const previous = scope.value;
  const groups = element("optgroup");
  groups.label = "Группы";
  groups.append(...snapshot.groups.map((group) => new Option(group.name, `group:${group.id}`)));
  const accounts = element("optgroup");
  accounts.label = "Счета";
  accounts.append(...snapshot.accounts.map((item) => new Option(item.name, `account:${item.id}`)));
  scope.replaceChildren(new Option("Все счета", "all"), groups, accounts);
  if (Array.from(scope.options).some((option) => option.value === previous)) scope.value = previous;
}

function render() {
  const today = localDateKey();
  const [kind, id] = scope.value.split(":");
  const selected = snapshot.accounts.filter((item) =>
    kind === "all" || (kind === "group" ? item.groupId === id : item.id === id));
  const ids = selected.map((item) => item.id);
  const result = summarize(snapshot, ids, periodBounds(period), today);
  byId("current-date").textContent = fullDay.format(new Date());
  colorDot("scope-color", kind === "account" ? findAccount(id)?.color : "mint");
  byId("balance").textContent = money(result.balance);
  byId("income").textContent = money(result.income);
  byId("expenses").textContent = money(result.expense);
  byId("period-change").textContent = signedMoney(result.change);

  if (!byId("journal").hidden) {
    const itemsByDate = new Map();
    const selectedIds = new Set(ids);
    for (const operation of result.rows) {
      if (!itemsByDate.has(operation.date)) itemsByDate.set(operation.date, []);
      itemsByDate.get(operation.date).push(renderOperation(operation, selectedIds));
    }
    byId("journal-empty").hidden = result.rows.length > 0;
    byId("entries").replaceChildren(...Array.from(itemsByDate, ([day, rows]) => {
      const title = day === today ? "Сегодня" : datedDay.format(new Date(day + "T12:00:00"));
      return block(title, rows);
    }));
    download.hidden = false;
  } else {
    renderDirectory(result.balances);
  }
}

scope.addEventListener("change", () => { if (snapshot) render(); });
byId("periods").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || !snapshot) return;
  period = button.dataset.period;
  for (const item of byId("periods").querySelectorAll("button")) {
    item.setAttribute("aria-pressed", String(item === button));
  }
  render();
});

function renderDirectory(balances) {
  const grouped = [...snapshot.groups, { id: null, name: "Без группы" }]
    .map((group) => {
      const rows = snapshot.accounts.filter((item) => item.groupId === group.id).map((item) =>
        row(item.name, item.id === "card" ? "Основной счёт" : "", "▰", item.color,
          money(balances.get(item.id)), "", () => openDirectory("accounts", item)));
      return rows.length ? block(group.name, rows) : null;
    });
  byId("accounts-list").replaceChildren(...grouped.filter(Boolean));
  byId("groups-list").replaceChildren(...snapshot.groups.map((item) => {
    const count = snapshot.accounts.filter((account) => account.groupId === item.id).length;
    return row(item.name, "", "▦", "mint", String(count), "", () => openDirectory("groups", item));
  }));
  byId("categories-list").replaceChildren(...["expense", "income"].map((type) =>
    block(type === "expense" ? "Расходы" : "Доходы", snapshot.categories
      .filter((item) => item.type === type)
      .map((item) => row(item.name, "", item.name[0], item.color, "", "", () => openDirectory("categories", item))))));
}

function openDirectory(store, record) {
  if (!snapshot) return;
  directoryStore = store;
  editingRecord = record;
  byId("editor-title").textContent = directoryNames[store][record ? 1 : 0];
  byId("record-name").value = record?.name ?? "";
  byId("group-field").hidden = store !== "accounts";
  byId("opening-field").hidden = store !== "accounts";
  byId("record-color-field").hidden = store === "groups";
  byId("record-type-field").hidden = store !== "categories";
  byId("record-type").disabled = !!record;
  byId("record-type").value = record?.type ?? "expense";
  byId("record-color").value = record?.color ?? "mint";
  byId("record-opening").value = amountForInput(record?.openingKopecks ?? 0);
  populate(byId("record-group"), snapshot.groups, record?.groupId ?? "", "Без группы");
  colorDot("record-color-dot", byId("record-color").value);
  editorMessage.textContent = "";
  directoryDialog.showModal();
}

for (const button of document.querySelectorAll("[data-add]")) {
  button.addEventListener("click", () => openDirectory(button.dataset.add));
}
byId("record-color").addEventListener("change", (event) => colorDot("record-color-dot", event.target.value));

function openingBalance(value) {
  const input = normalizeAmount(value);
  if (input === "" || /^-?0{1,12}(,0{0,2})?$/.test(input)) return 0;
  const digits = input.replace(/^-/, "");
  const amount = amountInKopecks(digits);
  return amount === null ? null : input.startsWith("-") ? -amount : amount;
}

directoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = byId("save-record");
  if (submit.disabled) return;
  const name = byId("record-name").value.trim();
  if (!name) {
    editorMessage.textContent = "Введите название.";
    return;
  }
  const previous = editingRecord;
  const record = { id: previous?.id ?? crypto.randomUUID(), name };
  if (directoryStore === "accounts") {
    record.openingKopecks = openingBalance(byId("record-opening").value);
    if (record.openingKopecks === null) {
      editorMessage.textContent = "Проверьте начальный остаток. Допустимо до двух знаков после запятой.";
      return;
    }
    record.groupId = byId("record-group").value || null;
  }
  if (directoryStore !== "groups") record.color = byId("record-color").value;
  if (directoryStore === "categories") record.type = byId("record-type").value;

  submit.disabled = true;
  try {
    await writeRecord(await database, directoryStore, record, previous ? previous.revision ?? 0 : undefined);
    await refresh();
    directoryDialog.close();
    showPageMessage("Изменения сохранены.", true);
  } catch (error) {
    editorMessage.textContent = error?.message || "Не удалось сохранить изменения.";
    refresh();
  } finally {
    submit.disabled = false;
  }
});

async function refresh() {
  const db = await database;
  if (!db) return;
  try {
    snapshot = await readLedger(db);
    updateScope();
    render();
  } catch {
    showPageMessage("Не удалось открыть журнал. Откройте приложение снова.", false);
  }
}

download.addEventListener("click", async () => {
  try {
    const data = await readLedger(await database);
    const copy = { format: "karman", version: 2, exportedAt: new Date().toISOString(), ...data };
    const blob = new Blob([JSON.stringify(copy, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `karman-${localDateKey()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    showPageMessage("Не удалось скачать копию. Попробуйте ещё раз.", false);
  }
});

if ("serviceWorker" in navigator) {
  const markOfflineReady = () => {
    if (navigator.serviceWorker.controller) {
      byId("offline-status").classList.add("ready");
      byId("offline-status").lastChild.textContent = " Офлайн готов";
    }
  };
  navigator.serviceWorker.addEventListener("controllerchange", markOfflineReady);
  navigator.serviceWorker.register("./sw.js").then(markOfflineReady).catch((error) => {
    console.warn("Не удалось подготовить офлайн-режим", error);
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});

refresh().then(() => {
  if (mobile.matches) openOperation();
});
