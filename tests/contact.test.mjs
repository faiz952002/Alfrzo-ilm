// S1 / D6 / F2: the contact-info rule must behave identically in the database and in the browser.
// One shared list of cases (tests/fixtures/contact_info_cases.json) is checked against both:
//   * public.contains_contact_info(text)  - migration 001, enforced by the database (through the guard)
//   * CONTACT_RE in public/js/ui.js        - the check the pages run before sending
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sqlSync } from './lib/db.mjs';
import { CONTACT_RE } from '../public/js/ui.js';

const spec = JSON.parse(fs.readFileSync(new URL('./fixtures/contact_info_cases.json', import.meta.url), 'utf8'));
const dollar = t => { assert.ok(!t.includes('$c$')); return `$c$${t}$c$`; };

test('the shared case list is well formed', () => {
  assert.ok(spec.cases.length >= 40);
  for (const c of spec.cases) { assert.equal(typeof c.text, 'string'); assert.equal(typeof c.contact, 'boolean'); }
  assert.ok(spec.cases.some(c => c.contact) && spec.cases.some(c => !c.contact));
});

test('database: contains_contact_info() gives exactly the specified answer for every case', () => {
  const out = sqlSync(spec.cases.map((c, i) => `select ${i}, public.contains_contact_info(${dollar(c.text)});`).join('\n')).split('\n');
  const got = Object.fromEntries(out.map(l => l.split('|')).map(([i, v]) => [Number(i), v === 't']));
  const wrong = spec.cases.filter((c, i) => got[i] !== c.contact).map(c => `${JSON.stringify(c.text)} expected ${c.contact}`);
  assert.deepEqual(wrong, []);
});

test('browser: CONTACT_RE gives exactly the specified answer for every case', () => {
  const wrong = spec.cases.filter(c => CONTACT_RE.test(c.text) !== c.contact).map(c => `${JSON.stringify(c.text)} expected ${c.contact}`);
  assert.deepEqual(wrong, []);
});

test('known gaps are listed explicitly (not silently accepted)', () => {
  const gaps = spec.cases.filter(c => c.known_gap);
  assert.ok(gaps.length >= 2, 'the Devanagari / Arabic digit gap stays visible until a forward fix');
  for (const g of gaps) assert.equal(g.contact, false);
});
