'use strict';

/* =========================================================================
 * storage.js — IndexedDB persistence for per-user health data.
 *
 * Replaces the old model of a single data/health.json in the repo.
 * Each user's data lives in their browser's IndexedDB.
 * ========================================================================= */

const _DB_NAME = 'garmin-health';
const _DB_VERSION = 1;
const _STORE = 'days';

let _dbPromise;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(_DB_NAME, _DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(_STORE)) {
        db.createObjectStore(_STORE, { keyPath: 'date' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

/* Read all rows sorted by date */
async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_STORE, 'readonly');
    const req = tx.objectStore(_STORE).getAll();
    req.onsuccess = () => resolve(
      (req.result || []).sort((a, b) => a.date.localeCompare(b.date))
    );
    req.onerror = () => reject(req.error);
  });
}

/* Upsert a batch of day records (merges fields per date) */
async function dbPutDays(rows) {
  if (!rows.length) return;
  const db = await openDB();
  const tx = db.transaction(_STORE, 'readwrite');
  const store = tx.objectStore(_STORE);

  for (const row of rows) {
    await new Promise((resolve, reject) => {
      const get = store.get(row.date);
      get.onsuccess = () => {
        const merged = { ...(get.result || {}), ...row };
        const put = store.put(merged);
        put.onsuccess = () => resolve();
        put.onerror = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    });
  }

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/* Clear all stored data */
async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_STORE, 'readwrite');
    const req = tx.objectStore(_STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* Count stored days */
async function dbCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_STORE, 'readonly');
    const req = tx.objectStore(_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
