const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const { RoomPersistence } = require('../dist/services/roomPersistence');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const waitUntil = async (predicate) => {
  const end = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

test('failed hydration refuses access and never overwrites stored state', async () => {
  let writes = 0;
  const storage = { load: async () => { throw new Error('read unavailable'); }, save: async () => { writes++; } };
  const rooms = new RoomPersistence(storage);
  await assert.rejects(rooms.acquire('board'), /read unavailable/);
  await rooms.flushAll();
  assert.equal(writes, 0);
});

test('concurrent join waits for one load, then immediately tracks edits', async () => {
  const read = deferred();
  let loads = 0, writes = 0;
  const rooms = new RoomPersistence({ load: () => { loads++; return read.promise; }, save: async () => { writes++; } });
  let acquired = false;
  const first = rooms.acquire('board').then(handle => { acquired = true; return handle; });
  const second = rooms.acquire('board');
  await tick();
  assert.equal(acquired, false);
  assert.equal(loads, 1);
  read.resolve(null);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.doc, b.doc);
  a.doc.getMap('canvas-objects').set('shape', { type: 'rect' });
  await rooms.flushAll();
  assert.equal(writes, 1);
  await a.release();
  assert.equal(a.doc.isDestroyed, false);
  await b.release();
  assert.equal(a.doc.isDestroyed, true);
});

test('writes are serialized and rejoin during final save keeps the latest document', async () => {
  let persisted = null, loads = 0;
  const writes = [];
  const rooms = new RoomPersistence({
    load: async () => { loads++; return persisted; },
    save: async (_, state) => {
      const gate = deferred();
      writes.push({ state, gate });
      await gate.promise;
      persisted = state;
    },
  });
  const a = await rooms.acquire('board');
  a.doc.getMap('canvas-objects').set('shape', { left: 10 });
  const closing = a.release();
  await tick();
  const b = await rooms.acquire('board');
  assert.equal(b.doc, a.doc);
  assert.equal(loads, 1);
  b.doc.getMap('canvas-objects').set('shape', { left: 20 });
  const flushing = rooms.flushAll();
  await tick();
  assert.equal(writes.length, 1);
  writes[0].gate.resolve();
  await waitUntil(() => writes.length === 2);
  writes[1].gate.resolve();
  await Promise.all([closing, flushing]);
  const decoded = new Y.Doc();
  Y.applyUpdate(decoded, persisted);
  assert.equal(decoded.getMap('canvas-objects').get('shape').left, 20);
  assert.equal(b.doc.isDestroyed, false);
  await b.release();
  decoded.destroy();
});

test('failed final save retains the document and a retry makes it durable', async () => {
  let failures = true, saved = null, errors = 0;
  const rooms = new RoomPersistence({
    load: async () => null,
    save: async (_, state) => { if (failures) throw new Error('write unavailable'); saved = state; },
  }, { retryMs: 15, onError: () => errors++ });
  const a = await rooms.acquire('board');
  a.doc.getMap('canvas-objects').set('shape', { type: 'rect' });
  await a.release();
  assert.equal(a.doc.isDestroyed, false);
  assert.equal(rooms.pendingRooms, 1);
  const b = await rooms.acquire('board');
  assert.equal(b.doc, a.doc);
  failures = false;
  await waitUntil(() => saved !== null);
  assert.equal(errors, 1);
  assert.equal(rooms.pendingRooms, 0);
  await b.release();
});

test('maximum save interval prevents continuous edits postponing durability', async () => {
  let writes = 0;
  const rooms = new RoomPersistence({ load: async () => null, save: async () => { writes++; } }, { debounceMs: 100, maxWaitMs: 30 });
  const handle = await rooms.acquire('board');
  const timer = setInterval(() => handle.doc.getMap('canvas-objects').set('shape', { left: Date.now() }), 5);
  try { await waitUntil(() => writes > 0); }
  finally { clearInterval(timer); await handle.release(); }
});

test('saved snapshot hydrates a new room after successful collection', async () => {
  let state = null;
  const rooms = new RoomPersistence({ load: async () => state, save: async (_, update) => { state = update; } });
  const a = await rooms.acquire('board');
  a.doc.getMap('canvas-objects').set('shape', { type: 'circle', radius: 40 });
  await a.release();
  const b = await rooms.acquire('board');
  assert.notEqual(b.doc, a.doc);
  assert.equal(b.doc.getMap('canvas-objects').get('shape').radius, 40);
  await b.release();
});
