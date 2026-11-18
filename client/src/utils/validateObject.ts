import type { SerializedCanvasObject } from '../types/whiteboard';

const supported = new Set(['rect', 'circle', 'path', 'i-text', 'textbox']);
const numeric = new Set(['left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle', 'skewX', 'skewY', 'opacity', 'strokeWidth', 'strokeDashOffset', 'strokeMiterLimit', 'radius', 'rx', 'ry', 'fontSize', 'charSpacing', 'lineHeight', 'padding', '_stickyBaseFontSize', '_stickyBaseWidth', '_stickyScale']);
const text = new Set(['type', 'version', 'id', 'creatorId', 'originX', 'originY', 'fill', 'stroke', 'strokeLineCap', 'strokeLineJoin', 'backgroundColor', 'fillRule', 'paintFirst', 'globalCompositeOperation', 'fontFamily', 'fontWeight', 'fontStyle', 'textAlign', 'textBackgroundColor', 'text', 'direction']);
const flags = new Set(['flipX', 'flipY', 'visible', 'strokeUniform', 'selectable', 'evented', 'hasControls', 'lockScalingFlip', 'splitByGrapheme', 'underline', 'overline', 'linethrough', '_isSticky']);

// Only the vector/text types produced by our tools may reach Fabric enlivening.
// Images, SVG imports, patterns, gradients, clip paths, and arbitrary subclasses
// are deliberately outside the whiteboard document format.
export const validateObject = (input: unknown, objectId: string): SerializedCanvasObject | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || objectId.length > 128) return null;
  const source = input as SerializedCanvasObject;
  if (!supported.has(source.type) || source.id !== objectId) return null;
  const result: SerializedCanvasObject = { id: objectId };
  for (const [key, value] of Object.entries(source)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return null;
    if (numeric.has(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) return null;
      if (['width', 'height', 'radius', 'strokeWidth', 'fontSize', 'padding'].includes(key) && value < 0) return null;
      result[key] = value;
    } else if (text.has(key)) {
      if (value === null && ['stroke', 'fill'].includes(key)) { result[key] = null; continue; }
      if (key === 'fontWeight' && typeof value === 'number') {
        if (!Number.isFinite(value) || value < 1 || value > 1000) return null;
        result[key] = value; continue;
      }
      if (typeof value !== 'string' || value.length > (key === 'text' ? 10_000 : 256)) return null;
      result[key] = value;
    } else if (flags.has(key)) {
      if (typeof value !== 'boolean') return null;
      result[key] = value;
    } else if (key === 'path') {
      if (value === null && source.type !== 'path') continue;
      if (!Array.isArray(value) || value.length > 50_000 || value.some((segment: unknown) =>
        !Array.isArray(segment) || segment.length > 8 || !/^[MLCQZHVSTAmlcqzhvsta]$/.test(segment[0]) ||
        segment.slice(1).some((part) => typeof part !== 'number' || !Number.isFinite(part) || Math.abs(part) > 1_000_000))) return null;
      result.path = value.map((segment: unknown[]) => [...segment]);
    } else if (key === 'strokeDashArray') {
      if (value !== null && (!Array.isArray(value) || value.length > 32 || value.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10_000))) return null;
      result[key] = value;
    } else if (key === 'shadow') {
      if (value === null) { result.shadow = null; continue; }
      if (!value || typeof value !== 'object' || typeof value.color !== 'string' || value.color.length > 128) return null;
      const shadow: SerializedCanvasObject = { color: value.color };
      for (const field of ['blur', 'offsetX', 'offsetY']) {
        if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || Math.abs(value[field]) > 512) return null;
        shadow[field] = value[field];
      }
      result.shadow = shadow;
    } else if (key === 'clipPath' && value != null) return null;
    else if (key === 'styles' && value && Object.keys(value).length > 0) return null;
  }
  if (source.type === 'path' && !result.path) return null;
  if (['i-text', 'textbox'].includes(source.type) && typeof result.text !== 'string') return null;
  return result;
};
