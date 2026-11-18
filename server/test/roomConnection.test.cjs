const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { WebsocketProvider } = require('y-websocket');
const { getYDoc, docs, setPersistence } = require('y-websocket/bin/utils');
const Y = require('yjs');
const { RoomPersistence } = require('../dist/services/roomPersistence');
const { connectRoom } = require('../dist/services/roomConnection');

const waitUntil = async (predicate) => {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for synchronization');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

const start = async (storage) => {
  setPersistence(null);
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const name = `test-${randomUUID()}`;
  const errors = [];
  const rooms = new RoomPersistence(storage, {
    createDoc: getYDoc,
    disposeDoc: (name, doc) => { if (docs.get(name) === doc) docs.delete(name); },
  });
  wss.on('connection', (ws, req) => void connectRoom(ws, req, rooms, undefined, error => errors.push(error)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const clients = [];
  const join = () => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`ws://127.0.0.1:${server.address().port}`, name, doc, { WebSocketPolyfill: WebSocket, disableBc: true });
    clients.push({ doc, provider });
    return { doc, provider };
  };
  const close = async () => {
    for (const { doc, provider } of clients) { provider.destroy(); provider.awareness.destroy(); doc.destroy(); }
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
    await rooms.flushAll();
  };
  return { join, close, errors, rooms };
};

test('WebSocket clients wait for hydration and two peers synchronize edits/deletes', async () => {
  let finishLoad;
  const loading = new Promise(resolve => { finishLoad = resolve; });
  const seed = new Y.Doc();
  seed.getMap('canvas-objects').set('saved', { type: 'rect', left: 10 });
  let persisted;
  const rig = await start({ load: () => loading, save: async (_, state) => { persisted = state; } });
  try {
    const a = rig.join();
    await waitUntil(() => a.provider.wsconnected);
    assert.equal(a.provider.synced, false);
    a.doc.getMap('canvas-objects').set('early', { type: 'circle', radius: 20 });
    finishLoad(Y.encodeStateAsUpdate(seed));
    await waitUntil(() => a.provider.synced && a.doc.getMap('canvas-objects').has('saved'));
    const b = rig.join();
    await waitUntil(() => b.provider.synced && b.doc.getMap('canvas-objects').has('early'));
    b.doc.getMap('canvas-objects').delete('saved');
    await waitUntil(() => !a.doc.getMap('canvas-objects').has('saved'));
    await rig.rooms.flushAll();
    const restored = new Y.Doc();
    Y.applyUpdate(restored, persisted);
    assert.equal(restored.getMap('canvas-objects').has('saved'), false);
    assert.equal(restored.getMap('canvas-objects').get('early').radius, 20);
    assert.equal(rig.errors.length, 0);
    restored.destroy();
  } finally { seed.destroy(); await rig.close(); }
});

test('failed database load closes the connection without claiming sync or saving', async () => {
  let saves = 0;
  const rig = await start({ load: async () => { throw new Error('unavailable'); }, save: async () => { saves++; } });
  try {
    const client = rig.join();
    await waitUntil(() => rig.errors.length > 0);
    assert.equal(client.provider.synced, false);
    assert.equal(saves, 0);
  } finally { await rig.close(); }
});
