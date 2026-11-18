import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fabric } from 'fabric';
import { CUSTOM_FABRIC_PROPS } from '../src/utils/fabricHelpers';
import { validateObject } from '../src/utils/validateObject';

test('all supported local Fabric tool snapshots pass validation', () => {
  const objects = [new fabric.Rect({ id: 'a', width: 20, height: 30 }), new fabric.Circle({ id: 'a', radius: 20 }),
    new fabric.Path('M 0 0 L 20 20', { id: 'a' }), new fabric.IText('Hello', { id: 'a' }),
    new fabric.Textbox('Note', { id: 'a', shadow: new fabric.Shadow({ color: '#000000', blur: 10, offsetX: 4, offsetY: 4 }) })];
  for (const object of objects) assert.ok(validateObject(object.toObject([...CUSTOM_FABRIC_PROPS]), 'a'), object.type);
});

test('external resources, invalid geometry, large text and prototype keys are rejected', () => {
  assert.equal(validateObject({ id: 'a', type: 'image', src: 'https://example.com/private' }, 'a'), null);
  assert.equal(validateObject({ id: 'a', type: 'rect', fill: { type: 'pattern', source: 'evil' } }, 'a'), null);
  assert.equal(validateObject({ id: 'a', type: 'rect', left: Infinity }, 'a'), null);
  assert.equal(validateObject({ id: 'a', type: 'i-text', text: 'x'.repeat(10_001) }, 'a'), null);
  assert.equal(validateObject(JSON.parse('{"id":"a","type":"rect","__proto__":{"polluted":true}}'), 'a'), null);
  assert.equal(validateObject({ id: 'a', type: 'rect', clipPath: { type: 'image' } }, 'a'), null);
});
