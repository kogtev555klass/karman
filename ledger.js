const initialAccounts = [
  { id: "card", name: "Основная карта", color: "mint", groupId: "wallet" },
  { id: "cash", name: "Наличные", color: "amber", groupId: "wallet" },
  { id: "reserve", name: "Запасная карта", color: "violet", groupId: "wallet" },
  { id: "broker", name: "Брокерский счёт", color: "sky", groupId: "investments" },
];

const initialCategories = [
  { id: "food", name: "Продукты", color: "mint", type: "expense" },
  { id: "transport", name: "Транспорт", color: "violet", type: "expense" },
  { id: "coffee", name: "Кофе", color: "amber", type: "expense" },
  { id: "salary", name: "Зарплата", color: "sky", type: "income" },
];

const initialGroups = [
  { id: "wallet", name: "Деньги на руках" },
  { id: "investments", name: "Инвестиции" },
];

const stores = ["operations", "accounts", "categories", "groups"];
const integerFormat = new Intl.NumberFormat("ru-RU");

export function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${month}-${day}`;
}

export function amountInKopecks(value) {
  const match = /^(\d{1,12})(?:[,.](\d{0,2}))?$/.exec(value);
  if (!match) return null;

  const rubles = Number(match[1]);
  const kopecks = Number((match[2] ?? "").padEnd(2, "0"));
  const amount = rubles * 100 + kopecks;
  return amount > 0 ? amount : null;
}

export function formatAmount(kopecks) {
  const signed = BigInt(kopecks);
  const amount = signed < 0n ? -signed : signed;
  const rubles = integerFormat.format(amount / 100n);
  const fraction = amount % 100n;
  const digits = fraction === 0n ? rubles : `${rubles},${String(fraction).padStart(2, "0")}`;
  return signed < 0n ? "−" + digits : digits;
}

export function amountForInput(kopecks) {
  return formatAmount(kopecks).replace(/\s/g, "").replace("−", "-");
}

export function periodBounds(period, now = new Date()) {
  const today = localDateKey(now);
  const date = new Date(now);
  switch (period) {
    case "today":
      return { start: today, end: today };
    case "yesterday":
      date.setDate(date.getDate() - 1);
      return { start: localDateKey(date), end: localDateKey(date) };
    case "week":
      date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      return { start: localDateKey(date), end: today };
    case "month":
      date.setDate(1);
      return { start: localDateKey(date), end: today };
    default:
      return { start: "", end: "9999-12-31" };
  }
}

export function summarize(snapshot, accountIds, bounds, today) {
  const selected = new Set(accountIds);
  const balances = new Map(snapshot.accounts.map((account) => [account.id, BigInt(account.openingKopecks)]));
  const rows = [];
  let income = 0n;
  let expense = 0n;
  let change = 0n;

  for (const operation of snapshot.operations) {
    const { type, accountId, targetAccountId, date } = operation;
    const amount = BigInt(operation.amountKopecks);
    const source = selected.has(accountId);
    const target = type === "transfer" && selected.has(targetAccountId);
    const delta = type === "income" ? amount : -amount;

    if (date <= today) {
      balances.set(accountId, balances.get(accountId) + delta);
      if (type === "transfer") balances.set(targetAccountId, balances.get(targetAccountId) + amount);
    }
    if (date < bounds.start || date > bounds.end || (!source && !target)) continue;
    rows.push(operation);
    if (type === "income") income += amount;
    if (type === "expense") expense += amount;
    if (source) change += delta;
    if (target) change += amount;
  }

  const balance = accountIds.reduce((sum, id) => sum + balances.get(id), 0n);
  rows.sort((first, second) =>
    second.date.localeCompare(first.date) || second.createdAt.localeCompare(first.createdAt));
  return { income, expense, change, balance, balances, rows };
}

export function openLedger() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("karman-finance", 2);
    request.onupgradeneeded = ({ oldVersion }) => {
      const database = request.result;
      if (oldVersion === 0) database.createObjectStore("operations", { keyPath: "id" });
      const accounts = database.createObjectStore("accounts", { keyPath: "id" });
      const categories = database.createObjectStore("categories", { keyPath: "id" });
      const groups = database.createObjectStore("groups", { keyPath: "id" });
      for (const account of initialAccounts) accounts.add({ ...account, openingKopecks: 0 });
      for (const category of initialCategories) categories.add(category);
      for (const group of initialGroups) groups.add(group);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Закройте другие окна «Кармана» и откройте приложение снова."));
  });
}

export function readLedger(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(stores);
    const requests = stores.map((name) => [name, transaction.objectStore(name).getAll()]);
    transaction.oncomplete = () => resolve(Object.fromEntries(requests.map(([name, request]) => [name, request.result])));
    transaction.onabort = () => reject(transaction.error);
  });
}

export function writeRecord(database, storeName, record, expectedRevision) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    let error;
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(error ?? transaction.error);
    if (expectedRevision === undefined) {
      store.add({ ...record, revision: 1 });
      return;
    }
    const request = store.get(record.id);
    request.onsuccess = () => {
      if (!request.result || (request.result.revision ?? 0) !== expectedRevision) {
        error = new Error("Запись изменилась в другом окне. Откройте её снова.");
        transaction.abort();
        return;
      }
      store.put({ ...record, revision: expectedRevision + 1 });
    };
  });
}
