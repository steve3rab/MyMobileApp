const DB_NAME = "MyMobileAppDB";
const DB_VERSION = 1;
const TRANSACTIONS = "transactions";
const SETTINGS = "settings";
let dbPromise;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRANSACTIONS)) {
        const store = db.createObjectStore(TRANSACTIONS, { keyPath: "id" });
        store.createIndex("month", "month", { unique: false });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("category", "category", { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS)) {
        db.createObjectStore(SETTINGS, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function waitForTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function waitForRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllTransactions() {
  const db = await openDatabase();
  const tx = db.transaction(TRANSACTIONS, "readonly");
  return waitForRequest(tx.objectStore(TRANSACTIONS).getAll());
}

export async function addTransaction(transaction) {
  const normalized = {
    ...transaction,
    id: transaction.id || crypto.randomUUID(),
    amount: Number(transaction.amount),
    month: transaction.date.slice(0, 7),
    createdAt: transaction.createdAt || Date.now()
  };
  const db = await openDatabase();
  const tx = db.transaction(TRANSACTIONS, "readwrite");
  tx.objectStore(TRANSACTIONS).put(normalized);
  await waitForTransaction(tx);
  return normalized;
}

export async function deleteTransaction(id) {
  const db = await openDatabase();
  const tx = db.transaction(TRANSACTIONS, "readwrite");
  tx.objectStore(TRANSACTIONS).delete(id);
  await waitForTransaction(tx);
}

export async function replaceTransactions(transactions) {
  const db = await openDatabase();
  const tx = db.transaction(TRANSACTIONS, "readwrite");
  const store = tx.objectStore(TRANSACTIONS);
  store.clear();
  for (const transaction of transactions) {
    store.put({
      ...transaction,
      id: transaction.id || crypto.randomUUID(),
      amount: Number(transaction.amount),
      month: transaction.month || transaction.date.slice(0, 7),
      createdAt: transaction.createdAt || Date.now()
    });
  }
  await waitForTransaction(tx);
}

export async function saveSetting(key, value) {
  const db = await openDatabase();
  const tx = db.transaction(SETTINGS, "readwrite");
  tx.objectStore(SETTINGS).put({ key, value });
  await waitForTransaction(tx);
}

export async function getSetting(key, fallback = null) {
  const db = await openDatabase();
  const tx = db.transaction(SETTINGS, "readonly");
  const result = await waitForRequest(tx.objectStore(SETTINGS).get(key));
  return result?.value ?? fallback;
}

export async function migrateLegacyLocalStorage(storageKey) {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return false;
  try {
    const legacy = JSON.parse(raw);
    if (Array.isArray(legacy.transactions)) {
      await replaceTransactions(legacy.transactions);
    }
    if (legacy.budgetLimit !== undefined) {
      await saveSetting("budgetLimit", Number(legacy.budgetLimit) || 0);
    }
    localStorage.removeItem(storageKey);
    return true;
  } catch (error) {
    console.warn("Migration localStorage impossible", error);
    return false;
  }
}


export async function purgeDatabase() {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch (error) {
      console.warn("Fermeture IndexedDB impossible", error);
    }
    dbPromise = undefined;
  }

  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("La base est encore ouverte dans un autre onglet."));
  });
}
