(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UnHoarderWorkspaceStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DB_NAME = 'unhoarder-builder';
  const DB_VERSION = 1;
  const STORE_NAME = 'workspace';
  const WORKSPACE_VERSION = 1;
  const FILE_KINDS = ['weapons', 'armor', 'misc', 'itemtypes', 'uniques', 'sets'];

  let dbPromise = null;

  function isSupported() {
    return Boolean(root && root.indexedDB);
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
  }

  function openDatabase() {
    if (!isSupported()) return Promise.reject(new Error('IndexedDB is not available in this browser.'));
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('Unable to open the local UnHoarder workspace.'));
      };
      request.onblocked = () => {
        dbPromise = null;
        reject(new Error('The local UnHoarder workspace is blocked by another open version of the site.'));
      };
    });
    return dbPromise;
  }

  async function withStore(mode, callback) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let result;
      try { result = callback(store); }
      catch (err) { reject(err); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction was aborted.'));
    });
  }

  async function get(key) {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readonly');
    return requestPromise(tx.objectStore(STORE_NAME).get(key));
  }

  function put(record) {
    return withStore('readwrite', store => store.put(record));
  }

  function remove(key) {
    return withStore('readwrite', store => store.delete(key));
  }

  function saveFilter(filter, selected) {
    return put({
      key: 'filter',
      workspaceVersion: WORKSPACE_VERSION,
      savedAt: Date.now(),
      filter,
      selected
    });
  }

  function saveUi(ui) {
    return put({
      key: 'ui',
      workspaceVersion: WORKSPACE_VERSION,
      savedAt: Date.now(),
      ...ui
    });
  }

  function saveFile(kind, name, text) {
    if (!FILE_KINDS.includes(kind)) return Promise.reject(new Error(`Unsupported workspace file kind: ${kind}`));
    return put({
      key: `file:${kind}`,
      workspaceVersion: WORKSPACE_VERSION,
      savedAt: Date.now(),
      kind,
      name,
      text
    });
  }

  function deleteFile(kind) {
    if (!FILE_KINDS.includes(kind)) return Promise.resolve();
    return remove(`file:${kind}`);
  }

  async function clearFiles() {
    await withStore('readwrite', store => {
      FILE_KINDS.forEach(kind => store.delete(`file:${kind}`));
    });
  }

  async function loadWorkspace() {
    const [filterRecord, uiRecord, ...fileRecords] = await Promise.all([
      get('filter'),
      get('ui'),
      ...FILE_KINDS.map(kind => get(`file:${kind}`))
    ]);

    const isCurrent = record => !record || record.workspaceVersion === WORKSPACE_VERSION;
    const versionMismatch = [filterRecord, uiRecord, ...fileRecords].some(record => !isCurrent(record));
    const files = {};
    fileRecords.forEach(record => {
      if (record && isCurrent(record) && FILE_KINDS.includes(record.kind)) files[record.kind] = record;
    });

    return {
      workspaceVersion: WORKSPACE_VERSION,
      versionMismatch,
      filter: filterRecord && isCurrent(filterRecord) ? filterRecord : null,
      ui: uiRecord && isCurrent(uiRecord) ? uiRecord : null,
      files
    };
  }

  async function clearAll() {
    await withStore('readwrite', store => store.clear());
  }

  return {
    DB_NAME,
    DB_VERSION,
    STORE_NAME,
    WORKSPACE_VERSION,
    FILE_KINDS: [...FILE_KINDS],
    isSupported,
    loadWorkspace,
    saveFilter,
    saveUi,
    saveFile,
    deleteFile,
    clearFiles,
    clearAll
  };
});
