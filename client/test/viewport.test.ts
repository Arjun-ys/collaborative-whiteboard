import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fabric } from 'fabric';
import { createViewport, exportCanvasPng, contentBounds, MIN_ZOOM, MAX_ZOOM } from '../src/utils/viewport';
import { readCollaborators } from '../src/utils/presence';
Object.assign(globalThis, { window: fabric.window, document: fabric.document });

test('zoom is bounded, pointer anchored, and reset restores the original view', () => {
  const canvas = new fabric.Canvas(null, { width: 500, height: 400 });
  const navigation = createViewport(canvas, () => 'select', () => {});
  try {
    navigation.zoomBy(100);
    assert.equal(canvas.getZoom(), MAX_ZOOM);
    assert.equal(canvas.viewportTransform![4], -750);
    navigation.zoomBy(0.0001);
    assert.equal(canvas.getZoom(), MIN_ZOOM);
    navigation.reset();
    assert.deepEqual(canvas.viewportTransform, [1, 0, 0, 1, 0, 0]);
  } finally { navigation.dispose(); canvas.dispose(); }
});

test('pan tool drags the viewport without moving any object', () => {
  const canvas = new fabric.Canvas(null, { width: 500, height: 400 });
  const object = new fabric.Rect({ left: 100, top: 100, width: 30, height: 30 });
  canvas.add(object);
  const navigation = createViewport(canvas, () => 'pan', () => {});
  try {
    canvas.fire('mouse:down', { e: new window.MouseEvent('mousedown', { clientX: 100, clientY: 100 }) });
    canvas.fire('mouse:move', { e: new window.MouseEvent('mousemove', { clientX: 150, clientY: 120 }) });
    canvas.fire('mouse:up', { e: new window.MouseEvent('mouseup') });
    assert.deepEqual(canvas.viewportTransform, [1, 0, 0, 1, 50, 20]);
    assert.equal(object.left, 100);
    assert.equal(object.top, 100);
  } finally { navigation.dispose(); canvas.dispose(); }
});

test('space temporarily suspends drawing and blur restores the drawing tool', () => {
  const canvas = new fabric.Canvas(null, { width: 500, height: 400 });
  const navigation = createViewport(canvas, () => 'brush', () => {});
  try {
    assert.equal(canvas.isDrawingMode, true);
    window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space' }));
    assert.equal(canvas.isDrawingMode, false);
    assert.equal(navigation.isNavigating(), true);
    window.dispatchEvent(new window.Event('blur'));
    assert.equal(canvas.isDrawingMode, true);
  } finally { navigation.dispose(); canvas.dispose(); }
});

test('fit includes offscreen and negative content', () => {
  const canvas = new fabric.Canvas(null, { width: 500, height: 400 });
  canvas.add(new fabric.Rect({ left: -200, top: -100, width: 50, height: 50 }), new fabric.Rect({ left: 900, top: 400, width: 50, height: 50 }));
  const navigation = createViewport(canvas, () => 'select', () => {});
  try {
    navigation.fit();
    const bounds = contentBounds(canvas)!;
    const center = fabric.util.transformPoint(new fabric.Point(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2), canvas.viewportTransform!);
    assert.equal(Math.round(center.x), 250);
    assert.equal(Math.round(center.y), 200);
    assert.ok(bounds.width * canvas.getZoom() <= 420.1);
  } finally { navigation.dispose(); canvas.dispose(); }
});

test('PNG export includes full content and preserves a zoomed viewport and selection', async () => {
  const canvas = new fabric.Canvas(null, { width: 500, height: 400, backgroundColor: '#ffffff' });
  const object = new fabric.Rect({ left: -100, top: -50, width: 1000, height: 200, fill: '#ff0000', strokeWidth: 0 });
  canvas.add(object);
  canvas.setActiveObject(object);
  canvas.setViewportTransform([2, 0, 0, 2, -200, -100]);
  try {
    const data = await exportCanvasPng(canvas);
    const png = Buffer.from(data.split(',')[1], 'base64');
    assert.equal(png.readUInt32BE(16), 2128);
    assert.equal(png.readUInt32BE(20), 528);
    assert.deepEqual(canvas.viewportTransform, [2, 0, 0, 2, -200, -100]);
    assert.equal(canvas.getActiveObject(), object);
  } finally { canvas.dispose(); }
});

test('presence ignores malformed and stale cursors and bounds selection input', () => {
  const peers = readCollaborators(new Map([
    [1, { user: { name: 'Me' } }],
    [2, { user: { name: 'Alice' }, presence: { cursor: { x: 40, y: 50, updatedAt: 1000 }, selectedIds: ['a', 2] } }],
    [3, { user: { name: 'Bob' }, presence: { cursor: { x: Infinity, y: 50, updatedAt: 1000 } } }],
  ]), 1, 2000);
  assert.equal(peers.length, 2);
  assert.deepEqual(peers[0].cursor, { x: 40, y: 50 });
  assert.deepEqual(peers[0].selectedIds, ['a']);
  assert.equal(peers[1].cursor, null);
  assert.equal(readCollaborators(new Map([[2, { user: { name: 'Alice' }, presence: { cursor: { x: 40, y: 50, updatedAt: 1000 } } }]]), 1, 20_000)[0].cursor, null);
});
