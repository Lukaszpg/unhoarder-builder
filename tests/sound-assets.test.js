const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
for (let i = 1; i <= 16; i++) {
  const name = `Filter${String(i).padStart(2, '0')}.flac`;
  const full = path.join(root, 'assets', 'sounds', name);
  assert(fs.existsSync(full), `missing preview sound: ${name}`);
  assert(fs.statSync(full).size > 0, `empty preview sound: ${name}`);
}
console.log('sound asset tests: OK');
