/**
 * Regression test for a bug that shipped in the first CI run: `generatedAt` alone made
 * every aggregate file differ on every run, so the 15-minute cron would have committed
 * ~96 times a day with no data change.
 *
 * The spec is explicit that this matters — "no commit when nothing changed… this keeps
 * git log readable, which matters more than it sounds" — because a readable log is the
 * debugging affordance the whole git-as-storage design is buying.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeIfChanged } from '../scripts/lib/write-if-changed.mjs';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wic-')), 'f.json');

test('writes when the file does not exist', () => {
  const f = tmp();
  assert.equal(writeIfChanged(f, { a: 1, generatedAt: 't1' }), true);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).a, 1);
});

test('does NOT rewrite when only generatedAt differs', () => {
  const f = tmp();
  writeIfChanged(f, { a: 1, generatedAt: 't1' });
  const before = fs.readFileSync(f, 'utf8');

  assert.equal(writeIfChanged(f, { a: 1, generatedAt: 't2-later' }), false);
  assert.equal(fs.readFileSync(f, 'utf8'), before, 'file must be byte-identical');
  assert.equal(JSON.parse(before).generatedAt, 't1', 'original timestamp preserved');
});

test('writes when real data changes, and takes the new timestamp with it', () => {
  const f = tmp();
  writeIfChanged(f, { a: 1, generatedAt: 't1' });
  assert.equal(writeIfChanged(f, { a: 2, generatedAt: 't2' }), true);
  const out = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(out.a, 2);
  assert.equal(out.generatedAt, 't2');
});

test('a nested change is detected, not just a top-level one', () => {
  const f = tmp();
  writeIfChanged(f, { rows: [[1, 2]], generatedAt: 't1' });
  assert.equal(writeIfChanged(f, { rows: [[1, 3]], generatedAt: 't2' }), true);
});

test('rewrites over a corrupt file rather than throwing', () => {
  const f = tmp();
  fs.writeFileSync(f, 'not json{{');
  assert.equal(writeIfChanged(f, { a: 1, generatedAt: 't1' }), true);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).a, 1);
});
