// Tests for shared/vault.ts — run with: node scripts/test-shared.ts
import assert from 'node:assert/strict';
import {
  backlinks,
  clozeCardId,
  emptyVault,
  extractClozes,
  graphEdges,
  mergeVaults,
  normalizeVault,
  parseWikilinks,
  renameLinksInBody,
  vaultDiffers,
  type Note,
  type Vault,
} from '../shared/vault.ts';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

function note(id: string, title: string, body: string, updatedAt = 1, extra: Partial<Note> = {}): Note {
  return { id, title, body, topicIds: [], tags: [], createdAt: 1, updatedAt, ...extra };
}

function vaultWith(...notes: Note[]): Vault {
  const v = emptyVault();
  for (const n of notes) v.notes[n.id] = n;
  return v;
}

console.log('shared/vault.ts');

test('parseWikilinks handles alias and heading', () => {
  assert.deepEqual(parseWikilinks('a [[A|b]] [[C#h]] [[ D ]]'), [
    { target: 'A', alias: 'b' },
    { target: 'C', alias: undefined },
    { target: 'D', alias: undefined },
  ]);
});

test('renameLinksInBody keeps headings and aliases, case-insensitive', () => {
  assert.equal(renameLinksInBody('see [[Old]] and [[old#Sec|x]] and [[Other]]', 'Old', 'New'), 'see [[New]] and [[New#Sec|x]] and [[Other]]');
});

test('extractClozes blanks one highlight per card', () => {
  const c = extractClozes({ id: 'n', title: 't', body: '- The ==mitochondria== is the ==powerhouse== of the cell\nplain ==mitochondria== dup' });
  assert.equal(c.length, 2);
  assert.equal(c[0].front, 'The **[…]** is the powerhouse of the cell');
  assert.equal(c[1].back, 'The mitochondria is the **powerhouse** of the cell');
  assert.equal(clozeCardId('n', c[0].key), clozeCardId('n', 'mitochondria'));
});

test('mergeVaults: newer record wins, union of records', () => {
  const a = vaultWith(note('1', 'A', 'old', 1), note('2', 'B', 'only in a', 5));
  const b = vaultWith(note('1', 'A', 'new', 2), note('3', 'C', 'only in b', 5));
  const m = mergeVaults(a, b);
  assert.equal(m.notes['1'].body, 'new');
  assert.ok(m.notes['2'] && m.notes['3']);
  assert.deepEqual(mergeVaults(b, a), m, 'merge is commutative');
});

test('mergeVaults: deletion wins ties and syncs', () => {
  const a = vaultWith(note('1', 'A', 'x', 3));
  const b = vaultWith(note('1', 'A', 'x', 3, { deleted: true }));
  assert.equal(mergeVaults(a, b).notes['1'].deleted, true);
  assert.equal(mergeVaults(b, a).notes['1'].deleted, true);
});

test('vaultDiffers detects incoming changes only', () => {
  const a = vaultWith(note('1', 'A', 'x', 3));
  assert.equal(vaultDiffers(a, a), false);
  assert.equal(vaultDiffers(a, vaultWith(note('1', 'A', 'y', 4))), true);
  assert.equal(vaultDiffers(vaultWith(note('1', 'A', 'y', 4), note('2', 'B', '')), a), true);
});

test('backlinks and graph edges', () => {
  const v = vaultWith(note('1', 'Sleep', 'see [[Caffeine]]'), note('2', 'Caffeine', 'affects [[sleep]] and [[Missing]]'), note('3', 'X', '[[Caffeine]]', 1, { deleted: true }));
  assert.deepEqual(
    backlinks(v, v.notes['2']).map((n) => n.id),
    ['1'],
  );
  assert.equal(graphEdges(v).length, 1);
});

test('normalizeVault fills missing collections', () => {
  const v = normalizeVault({ notes: {} } as Partial<Vault>);
  assert.deepEqual(Object.keys(v).sort(), ['cards', 'inbox', 'notes', 'reviews', 'schema', 'topics']);
});

console.log(`\n${passed} passed`);
