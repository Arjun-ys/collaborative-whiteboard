import { fabric } from 'fabric';
import { CUSTOM_FABRIC_PROPS } from './fabricHelpers';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export const contentBounds = (canvas: fabric.StaticCanvas) => {
  const objects = canvas.getObjects();
  if (!objects.length) return null;
  const bounds = objects.map((object) => object.getBoundingRect(true, true));
  const left = Math.min(...bounds.map((rect) => rect.left));
  const top = Math.min(...bounds.map((rect) => rect.top));
  const right = Math.max(...bounds.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...bounds.map((rect) => rect.top + rect.height));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
};

export const createViewport = (
  canvas: fabric.Canvas,
  getTool: () => string,
  onChange: () => void,
) => {
  let space = false;
  let dragging = false;
  let previous: { x: number; y: number } | null = null;
  const configure = () => {
    const pan = space || getTool() === 'pan';
    canvas.selection = getTool() === 'select' && !pan;
    canvas.skipTargetFind = pan;
    canvas.isDrawingMode = getTool() === 'brush' && !pan;
    canvas.defaultCursor = pan ? 'grab' : 'default';
  };
  const changed = () => {
    canvas.setViewportTransform(canvas.viewportTransform!);
    onChange();
  };
  const zoomAt = (point: fabric.Point, zoom: number) => {
    canvas.zoomToPoint(point, clampZoom(zoom));
    changed();
  };
  const zoomBy = (factor: number) => zoomAt(new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2), canvas.getZoom() * factor);
  const reset = () => { canvas.setViewportTransform([1, 0, 0, 1, 0, 0]); onChange(); };
  const fit = () => {
    canvas.discardActiveObject();
    const bounds = contentBounds(canvas);
    if (!bounds) { reset(); return; }
    const zoom = clampZoom(Math.min(
      Math.max(1, canvas.getWidth() - 80) / bounds.width,
      Math.max(1, canvas.getHeight() - 80) / bounds.height, 1,
    ));
    canvas.setViewportTransform([zoom, 0, 0, zoom,
      canvas.getWidth() / 2 - (bounds.left + bounds.width / 2) * zoom,
      canvas.getHeight() / 2 - (bounds.top + bounds.height / 2) * zoom]);
    onChange();
  };
  const down = (event: fabric.IEvent) => {
    const source = event.e as MouseEvent;
    if (space || getTool() === 'pan' || source.button === 1) {
      dragging = true;
      const pointer = canvas.getPointer(source, true);
      previous = { x: pointer.x, y: pointer.y };
      canvas.setCursor('grabbing');
    }
  };
  const move = (event: fabric.IEvent) => {
    if (!dragging || !previous) return;
    const pointer = canvas.getPointer(event.e, true);
    const transform = [...canvas.viewportTransform!];
    transform[4] += pointer.x - previous.x;
    transform[5] += pointer.y - previous.y;
    canvas.setViewportTransform(transform);
    previous = { x: pointer.x, y: pointer.y };
    onChange();
  };
  const up = () => { dragging = false; previous = null; configure(); canvas.setCursor(canvas.defaultCursor ?? 'default'); };
  const wheel = (event: fabric.IEvent) => {
    const source = event.e as WheelEvent;
    source.preventDefault();
    source.stopPropagation();
    if (source.ctrlKey || source.metaKey) {
      const point = canvas.getPointer(source, true);
      zoomAt(new fabric.Point(point.x, point.y), canvas.getZoom() * Math.exp(-source.deltaY * 0.005));
    } else {
      const transform = [...canvas.viewportTransform!];
      const unit = source.deltaMode === 1 ? 16 : source.deltaMode === 2 ? canvas.getHeight() : 1;
      transform[4] -= (source.shiftKey ? source.deltaY : source.deltaX) * unit;
      transform[5] -= (source.shiftKey ? 0 : source.deltaY) * unit;
      canvas.setViewportTransform(transform);
      onChange();
    }
  };
  const keyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest?.('button, a, input, textarea, [contenteditable="true"], [role="dialog"]') ||
        (canvas.getActiveObject() as fabric.IText | undefined)?.isEditing) return;
    if (event.code === 'Space' && !event.repeat) { event.preventDefault(); space = true; configure(); }
  };
  const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') { space = false; configure(); } };
  const blur = () => { space = false; up(); };
  canvas.fireMiddleClick = true;
  canvas.on('mouse:down', down);
  canvas.on('mouse:move', move);
  canvas.on('mouse:up', up);
  canvas.on('mouse:wheel', wheel);
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  configure();
  return {
    zoomBy, reset, fit, configure,
    isNavigating: () => dragging || space || getTool() === 'pan',
    dispose: () => {
      canvas.off('mouse:down', down); canvas.off('mouse:move', move);
      canvas.off('mouse:up', up); canvas.off('mouse:wheel', wheel);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
    },
  };
};

// Render a separate canvas so exporting never moves the user's viewport or
// changes selection/history. Crop to all content, including negative coordinates.
export const exportCanvasPng = async (canvas: fabric.Canvas) => {
  const output = new fabric.StaticCanvas(null, { enableRetinaScaling: false, renderOnAddRemove: false });
  try {
    await new Promise<void>((resolve) => output.loadFromJSON(canvas.toJSON([...CUSTOM_FABRIC_PROPS]), () => resolve()));
    const bounds = contentBounds(output) ?? { left: 0, top: 0, width: canvas.getWidth(), height: canvas.getHeight() };
    const padding = 32;
    const width = Math.max(1, bounds.width + padding * 2);
    const height = Math.max(1, bounds.height + padding * 2);
    const multiplier = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16_000_000 / (width * height)));
    return output.toDataURL({ format: 'png', left: bounds.left - padding, top: bounds.top - padding, width, height, multiplier });
  } finally { output.dispose(); }
};
