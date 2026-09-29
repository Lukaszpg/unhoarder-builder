const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Store = require('../js/workspace-store.js');
assert.strictEqual(Store.DB_NAME, 'unhoarder-builder');
assert.strictEqual(Store.DB_VERSION, 1);
assert.strictEqual(Store.WORKSPACE_VERSION, 1);
assert.deepStrictEqual(Store.FILE_KINDS, ['weapons', 'armor', 'misc', 'itemtypes', 'uniques', 'sets']);
assert.strictEqual(Store.isSupported(), false, 'Node should exercise the graceful no-IndexedDB path.');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
assert(html.includes('id="localSaveStatus"'));
assert(html.indexOf('js/workspace-store.js') < html.indexOf('js/app.js'));
assert(app.includes('WorkspaceStore.loadWorkspace()'));
assert(app.includes('WorkspaceStore.saveFilter('));
assert(app.includes('WorkspaceStore.saveFile('));
assert(app.includes('WorkspaceStore.clearFiles()'));
assert(app.includes("setLocalSaveStatus('Restored locally'"));
console.log('persistence contract tests: OK');
