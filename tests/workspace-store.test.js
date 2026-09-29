const assert = require('assert');

function makeFakeIndexedDB() {
  const records = new Map();
  let created = false;

  function requestWith(valueFactory, tx) {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    setImmediate(() => {
      try {
        req.result = valueFactory();
        if (req.onsuccess) req.onsuccess();
        if (tx && tx.oncomplete) tx.oncomplete();
      } catch (err) {
        req.error = err;
        if (req.onerror) req.onerror();
        if (tx && tx.onerror) { tx.error = err; tx.onerror(); }
      }
    });
    return req;
  }

  const db = {
    objectStoreNames: { contains: () => created },
    createObjectStore: () => { created = true; return {}; },
    close: () => {},
    transaction: () => {
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
      const store = {
        get(key) { return requestWith(() => records.get(key), tx); },
        put(record) { return requestWith(() => { records.set(record.key, structuredClone(record)); return record.key; }, tx); },
        delete(key) { return requestWith(() => { records.delete(key); }, tx); },
        clear() { return requestWith(() => { records.clear(); }, tx); }
      };
      tx.objectStore = () => store;
      return tx;
    }
  };

  return {
    open() {
      const req = { result: db, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      setImmediate(() => {
        if (!created && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    }
  };
}

global.indexedDB = makeFakeIndexedDB();
const Store = require('../js/workspace-store.js');

(async () => {
  assert.strictEqual(Store.isSupported(), true);
  await Store.clearAll();
  await Store.saveFilter({ version: 3, rules: [{ show: { conditions: { code: 'divo' } } }] }, 0);
  await Store.saveUi({ dataPanelCollapsed: true });
  await Store.saveFile('weapons', 'weapons.txt', 'name\tcode\ttype\nShako\tshak\thelm\n');
  await Store.saveFile('uniques', 'UniqueItems.txt', 'index\tcode\nHarlequin Crest\tshak\n');

  let restored = await Store.loadWorkspace();
  assert.strictEqual(restored.filter.filter.rules[0].show.conditions.code, 'divo');
  assert.strictEqual(restored.filter.selected, 0);
  assert.strictEqual(restored.ui.dataPanelCollapsed, true);
  assert.strictEqual(restored.files.weapons.name, 'weapons.txt');
  assert(restored.files.weapons.text.includes('Shako'));
  assert.strictEqual(restored.files.uniques.name, 'UniqueItems.txt');

  await Store.deleteFile('uniques');
  restored = await Store.loadWorkspace();
  assert.strictEqual(restored.files.uniques, undefined);
  assert(restored.files.weapons);

  await Store.clearFiles();
  restored = await Store.loadWorkspace();
  assert.deepStrictEqual(restored.files, {});
  assert.strictEqual(restored.filter.filter.version, 3, 'Clear data must not clear the filter.');

  console.log('workspace-store tests: OK');
})().catch(err => { console.error(err); process.exit(1); });
