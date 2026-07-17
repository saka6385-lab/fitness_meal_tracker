// IndexedDB wrapper for meals + settings storage.
const DB_NAME = 'muscle-meal-tracker';
const DB_VERSION = 1;
const MEALS_STORE = 'meals';
const SETTINGS_STORE = 'settings';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEALS_STORE)) {
        const store = db.createObjectStore(MEALS_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_date', 'dateKey', { unique: false });
        store.createIndex('by_timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

// Format a Date as local YYYY-MM-DD so entries group by the user's local day.
export function dateKeyFor(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function addMeal(meal) {
  const store = await tx(MEALS_STORE, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.add(meal);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function updateMeal(meal) {
  const store = await tx(MEALS_STORE, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(meal);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteMeal(id) {
  const store = await tx(MEALS_STORE, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getMealsByDate(dateKey) {
  const store = await tx(MEALS_STORE, 'readonly');
  const index = store.index('by_date');
  return new Promise((resolve, reject) => {
    const req = index.getAll(dateKey);
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.timestamp - b.timestamp));
    req.onerror = () => reject(req.error);
  });
}

export async function getAllMeals() {
  const store = await tx(MEALS_STORE, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.timestamp - a.timestamp));
    req.onerror = () => reject(req.error);
  });
}

// Returns distinct dateKeys that have at least one meal, newest first.
export async function getDatesWithMeals() {
  const meals = await getAllMeals();
  const seen = new Set();
  const dates = [];
  for (const m of meals) {
    if (!seen.has(m.dateKey)) {
      seen.add(m.dateKey);
      dates.push(m.dateKey);
    }
  }
  return dates;
}

export async function getSetting(key, fallback = null) {
  const store = await tx(SETTINGS_STORE, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
    req.onerror = () => reject(req.error);
  });
}

export async function setSetting(key, value) {
  const store = await tx(SETTINGS_STORE, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAllSettings() {
  const store = await tx(SETTINGS_STORE, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const out = {};
      for (const row of req.result) out[row.key] = row.value;
      resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}
