import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { canonicalSnapshot, snapshotForTheme, snapshotsMatch } from '../src/utils/canvasSnapshots';
import { resolveLeases } from '../src/utils/leases';

test('different themes resolve shared ink without changing the document or snapshot', () => {
  const doc = new Y.Doc();
  const map = doc.getMap('canvas-objects');
  const shape = { id: 'a', type: 'rect', stroke: '#f3f4f6', fill: 'transparent', left: 20 };
  map.set('a', shape);
  let writes = 0;
  doc.on('update', () => writes++);
  const light = snapshotForTheme(shape, 'light');
  const dark = snapshotForTheme(shape, 'dark');
  assert.equal(light.stroke, '#1e293b');
  assert.equal(dark.stroke, '#f3f4f6');
  assert.deepEqual(map.get('a'), shape);
  assert.equal(writes, 0);
  assert.deepEqual(canonicalSnapshot(light), shape);
  assert.deepEqual(canonicalSnapshot(dark), shape);
  doc.destroy();
});

test('custom accents and sticky colors remain unchanged across themes', () => {
  const accent = { type: 'i-text', fill: '#fb7185', text: 'Hello' };
  const sticky = { type: 'textbox', fill: '#1e293b', backgroundColor: '#fef08a', _isSticky: true };
  assert.deepEqual(snapshotForTheme(accent, 'light'), accent);
  assert.deepEqual(canonicalSnapshot(sticky), sticky);
  assert.deepEqual(snapshotForTheme(sticky, 'dark'), sticky);
});

test('snapshot equality ignores key order and detects remote property edits', () => {
  assert.equal(snapshotsMatch({ id: 'a', left: 10 }, { left: 10, id: 'a' }), true);
  assert.equal(snapshotsMatch({ id: 'a', left: 10 }, { id: 'a', left: 11 }), false);
  assert.equal(snapshotsMatch({ id: 'a' }, undefined), false);
});

test('group leases cover all objects with deterministic collision resolution and expiry', () => {
  const lease = (objectId: string, ownerClientId: number, claimedAt = 10) => ({ objectId, ownerClientId, claimedAt, expiresAt: 100, ownerUserId: 'user', ownerName: 'Name' });
  const states = new Map([
    [2, { locks: [lease('a', 2), lease('b', 2)] }],
    [1, { locks: [lease('a', 1)] }],
  ]);
  const result = resolveLeases(states, 20);
  assert.equal(result.a.ownerClientId, 1);
  assert.equal(result.b.ownerClientId, 2);
  assert.deepEqual(resolveLeases(states, 101), {});
});

test('malformed awareness and spoofed owners cannot acquire a lock', () => {
  assert.deepEqual(resolveLeases(new Map([[1, { locks: [null, {}, { objectId: 'a', ownerClientId: 2, claimedAt: 1, expiresAt: 100 }] }]]), 10), {});
});
