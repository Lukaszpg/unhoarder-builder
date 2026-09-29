const assert = require('assert');
const M = require('../js/filter-model.js');

assert.strictEqual(M.MAX_RULES, 4096);
assert.strictEqual(M.MAX_BYTES, 4 * 1024 * 1024);
assert.deepStrictEqual(M.RARITIES, ['inferior','normal','superior','magic','set','rare','unique']);
assert.strictEqual(M.classifyDataFilename('UniqueItems.txt'), 'uniques');
assert.strictEqual(M.classifyDataFilename('uniqueitems.txt'), 'uniques');
assert.strictEqual(M.classifyDataFilename('Uniques.txt'), null);

const weapons = M.parseCoreTable('weapons', 'name\tcode\ttype\ttype2\nShako\tshak\thelm\t\nCrystal Sword\tcrys\tswor\t\n');
const armor = M.parseCoreTable('armor', 'name\tcode\ttype\ttype2\nLacquered Plate\tuth\ttors\t\n');
const misc = M.parseCoreTable('misc', 'code\ttype\ttype2\ndivo\tcurr\t\n');
const itemtypes = M.parseCoreTable('itemtypes', 'ItemType\tCode\tEquiv1\tEquiv2\nHelm\thelm\tarmo\t\nArmor\tarmo\t\t\nSword\tswor\tweap\t\nWeapon\tweap\t\t\nTorso\ttors\tarmo\t\nCurrency\tcurr\t\t\n');
const uniques = M.parseEnrichmentTable('uniques', 'index\tcode\nHarlequin Crest\tshak\n');
const sets = M.parseEnrichmentTable('sets', 'index\titem\nTal Rasha\'s Guardianship\tuth\n');
const catalog = M.buildCatalog({ weapons, armor, misc, itemtypes, uniques, sets });
assert(catalog.baseNames.includes('Shako'));
assert(catalog.itemTypes.includes('helm'));
assert(catalog.itemTypes.includes('Helm'));
assert(catalog.uniqueItems[0].baseName === 'Shako');
assert(catalog.setItems[0].baseName === 'Lacquered Plate');

const itemRule = M.createRuleForFinderItem(catalog.uniqueItems[0], 'show');
assert.deepStrictEqual(itemRule, { show: { conditions: { baseName: 'Shako', rarity: 'unique' } } });

const filter = {
  version: 3,
  rules: [{
    show: {
      ruleName: 'Shako uniques',
      conditions: { baseName: 'Shako', rarity: 'unique', sockets: { gte: 1, lte: 6 } },
      tooltip: { backgroundColor: 'RGBA(110, 35, 160, 0.82)' },
      dropSound: 'Drop_Zing',
      minimapIcon: { shape: 'diamond', borderColor: 'RGBA(225, 205, 255, 1)', fillColor: 'RGBA(180, 140, 255, 0.82)', size: 20 }
    }
  }]
};
const valid = M.validateFilter(filter, catalog);
assert.deepStrictEqual(valid.errors, []);
assert.strictEqual(M.summarizeRule(filter.rules[0]).ruleName, 'Shako uniques');
const invalidRuleName = M.validateFilter({ version: 3, rules: [{ show: { ruleName: 123 } }] }, catalog);
assert(invalidRuleName.errors.some(x => x.includes('ruleName must be a string')));

const invalid = M.validateFilter({ version: 3, rules: [{ show: { conditions: { itemLevel: { gte: 100 } } } }] }, catalog);
assert(invalid.errors.some(x => x.includes('1..99')));
const invalidRarity = M.validateFilter({ version: 3, rules: [{ show: { conditions: { rarity: 'crafted' } } }] }, catalog);
assert(invalidRarity.errors.some(x => x.includes('unsupported value')));
assert(M.parseRgba('RGBA(255, 0, 128, 0.82)'));
assert.strictEqual(M.parseRgba('RGBA(256, 0, 0, 1)'), null);
console.log('filter-model tests: OK');
