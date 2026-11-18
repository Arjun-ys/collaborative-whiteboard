import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { fabric } from 'fabric';
import * as Y from 'yjs';
import { Whiteboard } from '../src/components/Whiteboard';
import { useStore } from '../src/store/useStore';
import { ToastContainer } from '../src/components/Toast';
import { confirmDialog } from '../src/utils/notifications';
import type { CanvasController } from '../src/types/whiteboard';
import type { CollaborationController } from '../src/types/collaboration';
import type { Collaborator } from '../src/types/collaboration';

// Exercise the real Fabric canvas and React event wiring using Fabric's
// installed Node DOM/canvas implementation, without browser automation.
Object.assign(globalThis, {
  window: fabric.window,
  document: fabric.document,
  ResizeObserver: class { observe() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
});

const mount = async (peers: Collaborator[] = []) => {
  useStore.setState({ activeTool: 'select', theme: 'dark', strokeColor: '#f3f4f6', fillColor: 'transparent', strokeWidth: 4, fontSize: 24, propertyRevision: 0 });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const doc = new Y.Doc();
  const map = doc.getMap<any>('canvas-objects');
  let canvas!: fabric.Canvas;
  let controller!: CanvasController;
  const claimed: string[][] = [];
  const collaboration: CollaborationController = {
    locks: {},
    peers,
    claimLock: () => true,
    claimLocks: (ids) => { claimed.push(ids); return true; },
    refreshLock: () => true,
    releaseLock: () => {},
    isLockOwnedByCurrentUser: () => true,
  };
  await act(async () => root.render(React.createElement(Whiteboard, {
    canvasObjectsMap: map, collaboration,
    registerCanvasRef: (value) => { if (value) canvas = value; },
    registerCanvasController: (value) => { if (value) controller = value; },
  })));
  const close = async () => {
    await act(async () => root.unmount());
    doc.destroy();
    host.remove();
  };
  return { doc, map, canvas, controller, claimed, close, host };
};

test('theme toggles on a selected object produce no shared edit or history invalidation', async () => {
  const rig = await mount();
  try {
    const rect = new fabric.Rect({ id: 'a', width: 40, height: 40, stroke: '#f3f4f6', fill: 'transparent' });
    await act(async () => { rig.canvas.add(rect); rig.canvas.setActiveObject(rect); });
    const original = rig.map.get('a');
    let writes = 0;
    rig.doc.on('update', () => writes++);
    await act(async () => useStore.getState().toggleTheme());
    assert.equal(rect.stroke, '#1e293b');
    assert.equal(writes, 0);
    assert.deepEqual(rig.map.get('a'), original);
    await act(async () => rig.controller.undo());
    assert.equal(rig.map.has('a'), false);
    await act(async () => rig.controller.redo());
    assert.equal(rig.map.has('a'), true);
    assert.equal(rig.canvas.getObjects()[0].stroke, '#1e293b');
  } finally { await rig.close(); }
});

test('group transform persists world coordinates in one transaction and one undo operation', async () => {
  const rig = await mount();
  try {
    const a = new fabric.Rect({ id: 'a', left: 10, top: 20, width: 40, height: 40 });
    const b = new fabric.Rect({ id: 'b', left: 100, top: 20, width: 40, height: 40 });
    await act(async () => rig.canvas.add(a, b));
    const original = [rig.map.get('a'), rig.map.get('b')];
    let transactions = 0;
    rig.map.observe(() => transactions++);
    await act(async () => {
      const group = new fabric.ActiveSelection([a, b], { canvas: rig.canvas });
      rig.canvas.setActiveObject(group);
      rig.canvas.fire('before:transform', { transform: { target: group, action: 'drag' } });
      group.set('left', (group.left ?? 0) + 50);
      rig.canvas.fire('object:modified', { target: group });
    });
    assert.deepEqual(rig.claimed.at(-1), ['a', 'b']);
    assert.equal(transactions, 1);
    assert.equal(rig.map.get('a').left, 60);
    assert.equal(rig.map.get('b').left, 150);
    await act(async () => rig.controller.undo());
    assert.deepEqual([rig.map.get('a'), rig.map.get('b')], original);
    await act(async () => rig.controller.redo());
    assert.equal(rig.map.get('a').left, 60);
    assert.equal(rig.map.get('b').left, 150);
  } finally { await rig.close(); }
});

test('sticky completion reflows width, resets scales, and preserves font size', async () => {
  const rig = await mount();
  try {
    const note = new fabric.Textbox('A note with enough words to reflow', { id: 'note', width: 220, fontSize: 24, fill: '#1e293b' });
    (note as any)._isSticky = true;
    await act(async () => {
      rig.canvas.add(note);
      note.set({ scaleX: 2, scaleY: 2 });
      rig.canvas.fire('object:modified', { target: note });
    });
    const saved = rig.map.get('note');
    assert.equal(saved.width, 440);
    assert.equal(saved.scaleX, 1);
    assert.equal(saved.scaleY, 1);
    assert.equal(saved.fontSize, 24);
  } finally { await rig.close(); }
});

test('changing theme while a sticky is selected keeps its fixed text color during later edits', async () => {
  const rig = await mount();
  try {
    const note = new fabric.Textbox('Note', { id: 'note', width: 220, fontSize: 24, fill: '#1e293b', backgroundColor: '#fef08a' });
    (note as any)._isSticky = true;
    await act(async () => { rig.canvas.add(note); rig.canvas.setActiveObject(note); });
    await act(async () => useStore.getState().toggleTheme());
    await act(async () => useStore.getState().toggleTheme());
    await act(async () => useStore.getState().setFontSize(30));
    assert.equal(rig.map.get('note').fill, '#1e293b');
    assert.equal(rig.map.get('note').fontSize, 30);
  } finally { await rig.close(); }
});

test('remote delete during a local drag removes the view and cannot be resurrected on completion', async () => {
  const rig = await mount();
  const peer = new Y.Doc();
  try {
    const rect = new fabric.Rect({ id: 'a', width: 40, height: 40 });
    await act(async () => {
      rig.canvas.add(rect);
      rig.canvas.setActiveObject(rect);
      rig.canvas.fire('before:transform', { transform: { target: rect, action: 'drag' } });
    });
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(rig.doc));
    peer.getMap('canvas-objects').delete('a');
    await act(async () => Y.applyUpdate(rig.doc, Y.encodeStateAsUpdate(peer)));
    assert.equal(rig.canvas.getObjects().length, 0);
    await act(async () => rig.canvas.fire('object:modified', { target: rect }));
    assert.equal(rig.map.has('a'), false);
  } finally { peer.destroy(); await rig.close(); }
});

test('remote edit received during drag is reconciled instead of overwritten at completion', async () => {
  const rig = await mount();
  const peer = new Y.Doc();
  try {
    const rect = new fabric.Rect({ id: 'a', left: 10, width: 40, height: 40 });
    await act(async () => {
      rig.canvas.add(rect);
      rig.canvas.setActiveObject(rect);
      rig.canvas.fire('before:transform', { transform: { target: rect, action: 'drag' } });
      rect.set('left', 50);
    });
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(rig.doc));
    const peerMap = peer.getMap<any>('canvas-objects');
    peerMap.set('a', { ...peerMap.get('a'), left: 100 });
    await act(async () => Y.applyUpdate(rig.doc, Y.encodeStateAsUpdate(peer)));
    assert.equal(rect.left, 50);
    await act(async () => rig.canvas.fire('object:modified', { target: rect }));
    assert.equal(rect.left, 100);
    assert.equal(rig.map.get('a').left, 100);
  } finally { peer.destroy(); await rig.close(); }
});

test('selection hydrates inspector values and an explicit property edit persists', async () => {
  const rig = await mount();
  try {
    const text = new fabric.IText('Hello', { id: 'text', fontSize: 36, fill: '#fb7185' });
    await act(async () => { rig.canvas.add(text); rig.canvas.setActiveObject(text); });
    assert.equal(useStore.getState().selectedObjectType, 'i-text');
    assert.equal(useStore.getState().fontSize, 36);
    assert.equal(useStore.getState().strokeColor, '#fb7185');
    await act(async () => useStore.getState().setFontSize(48));
    assert.equal(rig.map.get('text').fontSize, 48);
    assert.equal(rig.map.get('text').fill, '#fb7185');
  } finally { await rig.close(); }
});

test('undo skips a remotely modified object without exposing a misleading redo', async () => {
  const rig = await mount();
  const peer = new Y.Doc();
  try {
    await act(async () => rig.canvas.add(new fabric.Rect({ id: 'a', left: 10, width: 40, height: 40 })));
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(rig.doc));
    const peerMap = peer.getMap<any>('canvas-objects');
    peerMap.set('a', { ...peerMap.get('a'), left: 80 });
    await act(async () => Y.applyUpdate(rig.doc, Y.encodeStateAsUpdate(peer)));
    await act(async () => rig.controller.undo());
    assert.equal(rig.map.get('a').left, 80);
    assert.equal(useStore.getState().canRedo, false);
  } finally { peer.destroy(); await rig.close(); }
});

test('remote deletion of a group member ends remaining group interactions', async () => {
  const rig = await mount();
  const peer = new Y.Doc();
  try {
    const a = new fabric.Rect({ id: 'a', width: 40, height: 40 });
    const b = new fabric.Rect({ id: 'b', left: 100, width: 40, height: 40 });
    await act(async () => {
      rig.canvas.add(a, b);
      const group = new fabric.ActiveSelection([a, b], { canvas: rig.canvas });
      rig.canvas.setActiveObject(group);
      rig.canvas.fire('before:transform', { transform: { target: group, action: 'drag' } });
    });
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(rig.doc));
    peer.getMap('canvas-objects').delete('a');
    await act(async () => Y.applyUpdate(rig.doc, Y.encodeStateAsUpdate(peer)));
    // Undo creation of b should be permitted once the interrupted drag ends.
    await act(async () => rig.controller.undo());
    assert.equal(rig.map.has('b'), false);
  } finally { peer.destroy(); await rig.close(); }
});

test('clear dialog reuses pending requests, traps focus, and cancels on Escape', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(ToastContainer)));
  try {
    let first!: Promise<boolean>, second!: Promise<boolean>;
    await act(async () => {
      first = confirmDialog('Clear board?');
      second = confirmDialog('Clear again?');
    });
    assert.equal(first, second);
    const dialog = host.querySelector('[role="dialog"]')!;
    const buttons = dialog.querySelectorAll('button');
    assert.equal(document.activeElement, buttons[0]);
    await act(async () => buttons[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    assert.equal(document.activeElement, buttons[1]);
    await act(async () => buttons[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(await first, false);
    assert.equal(host.querySelector('[role="dialog"]'), null);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

test('peer cursor and selection overlays follow local zoom without shared writes', async () => {
  const rig = await mount([{ clientId: 2, name: 'Alice', color: '#60a5fa', cursor: { x: 500, y: 350 }, selectedIds: ['a'] }]);
  try {
    await act(async () => { rig.canvas.add(new fabric.Rect({ id: 'a', left: 500, top: 350, width: 40, height: 40 })); rig.canvas.renderAll(); });
    const cursor = rig.host.querySelector('.remote-cursor') as HTMLElement;
    assert.ok(cursor);
    assert.equal(cursor.style.left, '500px');
    assert.match(rig.host.querySelector('.remote-selection')!.textContent!, /Alice/);
    let writes = 0;
    rig.doc.on('update', () => writes++);
    await act(async () => rig.controller.zoomIn());
    const transformed = fabric.util.transformPoint(new fabric.Point(500, 350), rig.canvas.viewportTransform!);
    assert.equal((rig.host.querySelector('.remote-cursor') as HTMLElement).style.left, `${transformed.x}px`);
    assert.equal(writes, 0);
  } finally { await rig.close(); }
});
