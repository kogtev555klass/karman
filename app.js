import {
  accounts, categories, localDateKey, amountInKopecks, formatAmount,
  openLedger, readOperations, addOperation,
} from "./ledger.js";

const byId = (id) => document.getElementById(id);
const form = byId("expense-form");
const amount = byId("amount");
const account = byId("account");
const date = byId("expense-date");
const category = byId("category");
const save = byId("save-expense");
const message = byId("form-message");
const journalError = byId("journal-error");
const download = byId("download");
const monthDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const fullDay = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" });
const database = openLedger().catch(() => {
  journalError.textContent = "Не удалось открыть хранилище. Закройте другие окна «Кармана» и откройте приложение снова.";
  journalError.hidden = false;
  return null;
});

let saving = false;

accounts.forEach(({ id, name }) => account.add(new Option(name, id)));
categories.forEach(({ id, name }) => category.add(new Option(name, id)));
account.addEventListener("change", updateAccountColor);
resetForm();

function resetForm() {
  form.reset();
  date.value = localDateKey();
  updateAccountColor();
  alignAmount();
}

function updateAccountColor() {
  byId("account-dot").dataset.color = accounts.find(({ id }) => id === account.value)?.color;
}

function setView(view, focusHeading = false) {
  document.body.dataset.view = view;
  byId("show-expense").setAttribute("aria-current", view === "expense" ? "page" : "false");
  byId("show-journal").setAttribute("aria-current", view === "journal" ? "page" : "false");
  if (view === "journal") {
    if (focusHeading) {
      const heading = document.querySelector(".main-header h1");
      heading.tabIndex = -1;
      heading.focus();
    }
    refreshJournal();
  } else if (!amount.value) {
    resetForm();
    message.textContent = "";
  }
}

byId("show-expense").addEventListener("click", () => setView("expense"));
byId("header-add").addEventListener("click", () => setView("expense"));
byId("show-journal").addEventListener("click", () => setView("journal"));
byId("close-expense").addEventListener("click", () => setView("journal", true));

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

amount.addEventListener("input", () => {
  const value = amount.value.replace(/[\s\u00a0\u202f]/g, "").replace(".", ",");
  if (value !== amount.value) amount.value = value;
  alignAmount();
  clearMessage();
});

byId("keypad").addEventListener("click", (event) => {
  const key = event.target.closest("button")?.dataset.key;
  if (!key || saving) return;

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
  if (saving) return;
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

  saving = true;
  save.disabled = true;
  const operation = {
    type: "expense",
    amountKopecks,
    accountId: account.value,
    categoryId: category.value || null,
    date: date.value,
    createdAt: new Date().toISOString(),
  };
  try {
    const db = await database;
    if (!db) throw new Error("Хранилище недоступно");
    await addOperation(db, { ...operation, id: crypto.randomUUID() });
    resetForm();
    message.classList.add("success");
    message.textContent = `Сохранено · ${formatAmount(amountKopecks)} ₽`;
    refreshJournal();
  } catch {
    message.textContent = "Расход не сохранился. Проверьте, доступно ли хранилище, и попробуйте снова.";
  } finally {
    saving = false;
    save.disabled = false;
  }
});

function recordForExample(accountId, categoryId, amountKopecks, daysAgo) {
  const day = new Date();
  day.setDate(day.getDate() - daysAgo);
  return { accountId, categoryId, amountKopecks, date: localDateKey(day) };
}

function renderEntry(record) {
  const categoryInfo = categories.find(({ id }) => id === record.categoryId);
  const accountInfo = accounts.find(({ id }) => id === record.accountId);
  const row = document.createElement("li");
  row.className = "entry";

  const icon = document.createElement("span");
  icon.className = "entry-icon";
  icon.dataset.color = categoryInfo?.color ?? accountInfo?.color ?? "mint";
  icon.textContent = categoryInfo?.symbol ?? "↘";
  icon.setAttribute("aria-hidden", "true");

  const details = document.createElement("div");
  const title = document.createElement("strong");
  const subtitle = document.createElement("span");
  title.textContent = categoryInfo?.name ?? "Без категории";
  subtitle.textContent = `${accountInfo?.name ?? "Счёт"} · ${monthDay.format(new Date(record.date + "T12:00:00"))}`;
  details.append(title, subtitle);

  const value = document.createElement("strong");
  value.className = "entry-amount";
  value.textContent = `−${formatAmount(record.amountKopecks)} ₽`;
  row.append(icon, details, value);
  return row;
}

async function refreshJournal() {
  const today = localDateKey();
  byId("current-date").textContent = fullDay.format(new Date());
  try {
    const db = await database;
    if (!db) return;
    const records = await readOperations(db);
    const expenses = records.filter((record) => record.type === "expense");
    const total = expenses
      .filter((record) => record.date === today)
      .reduce((sum, record) => sum + BigInt(record.amountKopecks), 0n);
    byId("today-total").firstChild.textContent = formatAmount(total) + " ";
    byId("example-label").hidden = expenses.length > 0;
    download.hidden = records.length === 0;

    expenses.sort((first, second) =>
      second.date.localeCompare(first.date) || second.createdAt.localeCompare(first.createdAt));
    const rows = expenses.length > 0 ? expenses : [
      recordForExample("card", "food", 127450, 0),
      recordForExample("cash", "coffee", 24000, 0),
      recordForExample("reserve", "transport", 6500, 1),
    ];
    byId("entries").replaceChildren(...rows.slice(0, 30).map(renderEntry));
    journalError.hidden = true;
  } catch {
    journalError.textContent = "Не удалось открыть журнал. Откройте приложение снова.";
    journalError.hidden = false;
  }
}

download.addEventListener("click", async () => {
  try {
    const db = await database;
    if (!db) return;
    const operations = await readOperations(db);
    const copy = { format: "karman", version: 1, exportedAt: new Date().toISOString(), operations };
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
    journalError.textContent = "Не удалось скачать копию. Попробуйте ещё раз.";
    journalError.hidden = false;
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
  if (document.visibilityState === "visible") refreshJournal();
});
refreshJournal();
