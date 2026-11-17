export const accounts = [
  { id: "card", name: "Основная карта", color: "mint" },
  { id: "cash", name: "Наличные", color: "amber" },
  { id: "reserve", name: "Запасная карта", color: "violet" },
];

export const categories = [
  { id: "food", name: "Продукты", color: "mint", symbol: "П" },
  { id: "transport", name: "Транспорт", color: "violet", symbol: "Т" },
  { id: "coffee", name: "Кофе", color: "amber", symbol: "К" },
];

const integerFormat = new Intl.NumberFormat("ru-RU");

export function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
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
  const amount = BigInt(kopecks);
  const rubles = integerFormat.format(amount / 100n);
  const fraction = amount % 100n;
  return fraction === 0n ? rubles : `${rubles},${String(fraction).padStart(2, "0")}`;
}

export function openLedger() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("karman-finance", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("operations", { keyPath: "id" });
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

export function readOperations(database) {
  return new Promise((resolve, reject) => {
    const request = database.transaction("operations").objectStore("operations").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function addOperation(database, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("operations", "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.objectStore("operations").add(operation);
  });
}
