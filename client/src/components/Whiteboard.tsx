import React, { useEffect, useRef } from 'react';
import { fabric } from 'fabric';
import { useStore } from '../store/useStore';
import { CUSTOM_FABRIC_PROPS } from '../utils/fabricHelpers';
import { swapThemeColor } from '../utils/themeColors';
import { createId } from '../utils/id';
import { logger } from '../utils/logger';
import { confirmDialog, toast } from './Toast';
import type { CollaborationController } from '../types/collaboration';
import type { CanvasControllerRegistration, SerializedCanvasObject } from '../types/whiteboard';

type HistoryEntry =
  | { kind: 'object'; objectId: string; before?: SerializedCanvasObject; after?: SerializedCanvasObject }
  | { kind: 'clear'; objects: SerializedCanvasObject[] };

interface WhiteboardProps {
  canvasObjectsMap?: any;
  collaboration?: CollaborationController;
  onLocalObjectAdded?: (obj: fabric.Object) => void;
  onLocalObjectModified?: (obj: fabric.Object) => void;
  onLocalObjectRemoved?: (obj: fabric.Object) => void;
  registerCanvasRef?: (canvas: fabric.Canvas | null) => void;
  registerCanvasController?: CanvasControllerRegistration;
}

const MAX_HISTORY_ENTRIES = 100;
const DEFAULT_TEXT = 'Double-click to edit';
const DEFAULT_STICKY_TEXT = 'Write note...';

const cloneSerialized = (value: SerializedCanvasObject): SerializedCanvasObject =>
  JSON.parse(JSON.stringify(value)) as SerializedCanvasObject;

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
};

const snapshotsMatch = (left?: SerializedCanvasObject, right?: SerializedCanvasObject) =>
  stableStringify(left ?? null) === stableStringify(right ?? null);

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const Whiteboard: React.FC<WhiteboardProps> = ({
  canvasObjectsMap,
  collaboration,
  onLocalObjectAdded,
  onLocalObjectModified,
  onLocalObjectRemoved,
  registerCanvasRef,
  registerCanvasController,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
  const collaborationRef = useRef(collaboration);
  const reconcileLocksRef = useRef<(() => void) | null>(null);

  const {
    activeTool,
    setActiveTool,
    strokeColor,
    fillColor,
    strokeWidth,
    fontSize,
    userId,
    roomId,
    theme,
    setIsStickySelected,
    setHistoryState,
  } = useStore();

  const stateRef = useRef({ activeTool, strokeColor, fillColor, strokeWidth, fontSize, userId, roomId, theme });
  const isUpdatingFromYjsRef = useRef(false);
  const historyReplayRef = useRef(false);
  const historySuspendedRef = useRef(false);
  const objectIndexRef = useRef<Map<string, fabric.Object>>(new Map());
  const lastKnownObjectsRef = useRef<Map<string, SerializedCanvasObject>>(new Map());
  const historyPastRef = useRef<HistoryEntry[]>([]);
  const historyFutureRef = useRef<HistoryEntry[]>([]);
  const pendingCreationIdsRef = useRef<Set<string>>(new Set());
  const editingBeforeRef = useRef<Map<string, SerializedCanvasObject>>(new Map());
  const activeInteractionIdsRef = useRef<Set<string>>(new Set());
  const pendingRemoteRef = useRef<Map<string, SerializedCanvasObject | null>>(new Map());
  const isCreatingShapeRef = useRef(false);
  const startPointerRef = useRef<{ x: number; y: number } | null>(null);
  const activeShapeRef = useRef<fabric.Object | null>(null);

  useEffect(() => {
    collaborationRef.current = collaboration;
  }, [collaboration]);

  useEffect(() => {
    stateRef.current = { activeTool, strokeColor, fillColor, strokeWidth, fontSize, userId, roomId, theme };
  }, [activeTool, strokeColor, fillColor, strokeWidth, fontSize, userId, roomId, theme]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const initialWidth = wrapperRef.current?.clientWidth || window.innerWidth;
    const initialHeight = wrapperRef.current?.clientHeight || window.innerHeight;
    const canvas = new fabric.Canvas(canvasRef.current, {
      width: initialWidth,
      height: initialHeight,
      backgroundColor: stateRef.current.theme === 'light' ? '#ffffff' : '#000000',
      selection: true,
      preserveObjectStacking: true,
    });
    fabricCanvasRef.current = canvas;
    registerCanvasRef?.(canvas);

    const serialize = (object: fabric.Object) => object.toObject([...CUSTOM_FABRIC_PROPS]) as SerializedCanvasObject;
    const remember = (object: fabric.Object) => {
      if (object.id) lastKnownObjectsRef.current.set(object.id, cloneSerialized(serialize(object)));
    };
    const rememberSerialized = (id: string, value: SerializedCanvasObject) => {
      lastKnownObjectsRef.current.set(id, cloneSerialized(value));
    };
    const findById = (id: string) => objectIndexRef.current.get(id);
    const withRemoteUpdate = (callback: () => void) => {
      const wasUpdating = isUpdatingFromYjsRef.current;
      isUpdatingFromYjsRef.current = true;
      try {
        callback();
      } finally {
        isUpdatingFromYjsRef.current = wasUpdating;
      }
    };
    const syncHistoryState = () => {
      setHistoryState({ canUndo: historyPastRef.current.length > 0, canRedo: historyFutureRef.current.length > 0 });
    };
    const recordHistory = (entry: HistoryEntry) => {
      if (historySuspendedRef.current || historyReplayRef.current) return;
      historyPastRef.current.push(entry);
      if (historyPastRef.current.length > MAX_HISTORY_ENTRIES) historyPastRef.current.shift();
      historyFutureRef.current = [];
      syncHistoryState();
    };
    const updateStickyMetadata = (object: fabric.Object, value: SerializedCanvasObject) => {
      if (!value._isSticky) return;
      (object as any)._isSticky = true;
      (object as any)._stickyBaseFontSize = value._stickyBaseFontSize ?? 16;
      (object as any)._stickyBaseWidth = value._stickyBaseWidth ?? 220;
      (object as any)._stickyScale = value._stickyScale ?? 1;
    };
    const isLockedByCollaborator = (objectId?: string) => {
      if (!objectId) return false;
      const lease = collaborationRef.current?.locks[objectId];
      return !!lease && !collaborationRef.current?.isLockOwnedByCurrentUser(objectId);
    };
    const applyInteractivity = () => {
      const canSelect = stateRef.current.activeTool === 'select';
      canvas.forEachObject((object) => {
        const locked = isLockedByCollaborator(object.id);
        object.selectable = canSelect && !locked;
        object.evented = !locked;
        object.hoverCursor = locked ? 'not-allowed' : canSelect ? 'move' : 'crosshair';
      });
      const active = canvas.getActiveObject();
      if (active?.id && isLockedByCollaborator(active.id)) {
        finishInteraction(active.id);
        canvas.discardActiveObject();
      }
      canvas.requestRenderAll();
    };

    const commitNewObject = (object: fabric.Object) => {
      if (!object.id) object.id = createId();
      if (!object.creatorId) object.creatorId = stateRef.current.userId;
      objectIndexRef.current.set(object.id, object);
      const snapshot = cloneSerialized(serialize(object));
      recordHistory({ kind: 'object', objectId: object.id, after: snapshot });
      rememberSerialized(object.id, snapshot);
      if (canvasObjectsMap) canvasObjectsMap.set(object.id, snapshot);
      onLocalObjectAdded?.(object);
    };
    const persistModifiedObject = (object: fabric.Object) => {
      if (!object.id) return;
      if (isLockedByCollaborator(object.id)) {
        const latest = canvasObjectsMap?.get(object.id);
        if (latest) applyRemoteObject(object.id, latest);
        toast.warning('This object is being edited by a collaborator');
        return;
      }
      const before = lastKnownObjectsRef.current.get(object.id);
      const after = cloneSerialized(serialize(object));
      if (before && !snapshotsMatch(before, after)) {
        recordHistory({ kind: 'object', objectId: object.id, before: cloneSerialized(before), after });
      }
      rememberSerialized(object.id, after);
      if (canvasObjectsMap) canvasObjectsMap.set(object.id, after);
      onLocalObjectModified?.(object);
    };
    const removeObject = (object: fabric.Object) => {
      if (!object.id) return;
      const before = lastKnownObjectsRef.current.get(object.id);
      if (before) recordHistory({ kind: 'object', objectId: object.id, before: cloneSerialized(before) });
      objectIndexRef.current.delete(object.id);
      lastKnownObjectsRef.current.delete(object.id);
      if (canvasObjectsMap) canvasObjectsMap.delete(object.id);
      onLocalObjectRemoved?.(object);
    };

    const enlivenObject = (value: SerializedCanvasObject, onReady: (object: fabric.Object | null) => void) => {
      fabric.util.enlivenObjects([value], (objects: fabric.Object[]) => onReady(objects[0] ?? null), 'fabric');
    };
    const applyRemoteObject = (objectId: string, value: SerializedCanvasObject) => {
      if (activeInteractionIdsRef.current.has(objectId)) {
        if (collaborationRef.current?.isLockOwnedByCurrentUser(objectId)) return;
        pendingRemoteRef.current.set(objectId, cloneSerialized(value));
        return;
      }
      const existing = findById(objectId);
      if (existing) {
        withRemoteUpdate(() => {
          existing.set(value);
          updateStickyMetadata(existing, value);
          existing.setCoords();
          rememberSerialized(objectId, value);
        });
        applyInteractivity();
        return;
      }
      enlivenObject(value, (newObject) => {
        if (!newObject) return;
        const latest = canvasObjectsMap?.get(objectId) as SerializedCanvasObject | undefined;
        if (!latest || !snapshotsMatch(latest, value)) {
          if (latest) applyRemoteObject(objectId, latest);
          return;
        }
        withRemoteUpdate(() => {
          const duplicate = findById(objectId);
          if (duplicate) {
            duplicate.set(value);
            updateStickyMetadata(duplicate, value);
            duplicate.setCoords();
          } else {
            newObject.id = objectId;
            newObject.creatorId = value.creatorId;
            updateStickyMetadata(newObject, value);
            objectIndexRef.current.set(objectId, newObject);
            canvas.add(newObject);
          }
          rememberSerialized(objectId, value);
        });
        applyInteractivity();
      });
    };
    const applyRemoteDelete = (objectId: string) => {
      if (activeInteractionIdsRef.current.has(objectId)) {
        if (collaborationRef.current?.isLockOwnedByCurrentUser(objectId)) return;
        pendingRemoteRef.current.set(objectId, null);
        return;
      }
      const existing = findById(objectId);
      if (!existing) return;
      withRemoteUpdate(() => {
        objectIndexRef.current.delete(objectId);
        lastKnownObjectsRef.current.delete(objectId);
        canvas.remove(existing);
      });
      canvas.requestRenderAll();
    };
    const finishInteraction = (objectId?: string) => {
      if (!objectId) return;
      activeInteractionIdsRef.current.delete(objectId);
      collaborationRef.current?.releaseLock(objectId);
      const pending = pendingRemoteRef.current.get(objectId);
      pendingRemoteRef.current.delete(objectId);
      if (pending === null) applyRemoteDelete(objectId);
      else if (pending) applyRemoteObject(objectId, pending);
    };
    const beginInteraction = (object: fabric.Object, announceFailure = true) => {
      if (!object.id) return false;
      if (isLockedByCollaborator(object.id) || !collaborationRef.current?.claimLock(object.id)) {
        if (announceFailure) toast.info('Locked while a collaborator is editing this object');
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return false;
      }
      activeInteractionIdsRef.current.add(object.id);
      collaborationRef.current.refreshLock(object.id);
      return true;
    };

    const updateCanvasSize = () => {
      const width = wrapperRef.current?.clientWidth || window.innerWidth;
      const height = wrapperRef.current?.clientHeight || window.innerHeight;
      canvas.setDimensions({ width, height });
      canvas.requestRenderAll();
    };
    const wrapper = wrapperRef.current;
    const resizeObserver = wrapper ? new ResizeObserver(updateCanvasSize) : null;
    if (wrapper) resizeObserver?.observe(wrapper);
    window.addEventListener('resize', updateCanvasSize);

    const clearCanvas = async () => {
      const confirmed = await confirmDialog('Are you sure you want to clear the entire canvas?');
      if (!confirmed) return;
      const objects = canvas.getObjects().map((object) => cloneSerialized(serialize(object)));
      historySuspendedRef.current = true;
      withRemoteUpdate(() => {
        if (canvasObjectsMap) {
          canvasObjectsMap.doc.transact(() => canvasObjectsMap.forEach((_: unknown, key: string) => canvasObjectsMap.delete(key)));
        }
        canvas.clear();
        canvas.setBackgroundColor(stateRef.current.theme === 'light' ? '#ffffff' : '#000000', canvas.renderAll.bind(canvas));
        objectIndexRef.current.clear();
        lastKnownObjectsRef.current.clear();
      });
      historySuspendedRef.current = false;
      if (objects.length) recordHistory({ kind: 'clear', objects });
    };

    const exportPng = async () => {
      const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 2 });
      const fileName = `whiteboard-${stateRef.current.roomId}.png`;
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], fileName, { type: 'image/png' });
        if (isIOS() && navigator.share && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Whiteboard export' });
          toast.success('PNG ready to share');
          return;
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        logger.warn('[Export] Native share unavailable', error);
      }
      if (isIOS()) {
        const preview = window.open(dataUrl, '_blank', 'noopener,noreferrer');
        if (preview) toast.info('PNG opened in a new tab');
        else toast.error('Allow pop-ups to export this PNG');
        return;
      }
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('PNG export downloaded');
    };

    const restoreHistoryObject = (snapshot: SerializedCanvasObject, done: () => void) => {
      enlivenObject(snapshot, (object) => {
        if (!object) {
          done();
          return;
        }
        object.id = snapshot.id || createId();
        object.creatorId = snapshot.creatorId;
        updateStickyMetadata(object, snapshot);
        canvas.add(object);
        done();
      });
    };
    const currentMapMatches = (objectId: string, expected?: SerializedCanvasObject) => {
      if (!canvasObjectsMap) return true;
      return snapshotsMatch(canvasObjectsMap.get(objectId), expected);
    };
    const applyHistoryEntry = (entry: HistoryEntry, direction: 'undo' | 'redo') => {
      historyReplayRef.current = true;
      const finish = () => {
        historyReplayRef.current = false;
        syncHistoryState();
      };
      if (entry.kind === 'clear') {
        if (direction === 'redo') {
          entry.objects.forEach((snapshot) => {
            if (!snapshot.id || !currentMapMatches(snapshot.id, snapshot)) return;
            const existing = findById(snapshot.id);
            if (existing) canvas.remove(existing);
          });
          finish();
          return;
        }
        const restorations = entry.objects.filter((snapshot) => snapshot.id && !canvasObjectsMap?.has(snapshot.id));
        if (!restorations.length) {
          toast.info('Undo skipped because the board changed remotely');
          finish();
          return;
        }
        let remaining = restorations.length;
        restorations.forEach((snapshot) => restoreHistoryObject(snapshot, () => {
          remaining -= 1;
          if (remaining === 0) finish();
        }));
        return;
      }

      const expected = direction === 'undo' ? entry.after : entry.before;
      const target = direction === 'undo' ? entry.before : entry.after;
      if (!currentMapMatches(entry.objectId, expected)) {
        toast.info('History skipped because a collaborator changed this object');
        finish();
        return;
      }
      const existing = findById(entry.objectId);
      if (!target) {
        if (existing) canvas.remove(existing);
        finish();
        return;
      }
      if (existing) {
        existing.set(target);
        updateStickyMetadata(existing, target);
        existing.setCoords();
        canvas.fire('object:modified', { target: existing });
        canvas.requestRenderAll();
        finish();
        return;
      }
      restoreHistoryObject(target, finish);
    };
    const undo = () => {
      const entry = historyPastRef.current.pop();
      if (!entry) return;
      historyFutureRef.current.unshift(entry);
      applyHistoryEntry(entry, 'undo');
    };
    const redo = () => {
      const entry = historyFutureRef.current.shift();
      if (!entry) return;
      historyPastRef.current.push(entry);
      applyHistoryEntry(entry, 'redo');
    };
    registerCanvasController?.({ undo, redo, exportPng, clear: clearCanvas });
    syncHistoryState();

    canvas.on('object:added', (event) => {
      if (isUpdatingFromYjsRef.current) return;
      const object = event.target;
      if (!object) return;
      if (!object.id) object.id = createId();
      if (!object.creatorId) object.creatorId = stateRef.current.userId;
      objectIndexRef.current.set(object.id, object);
      if (pendingCreationIdsRef.current.has(object.id)) {
        remember(object);
        return;
      }
      commitNewObject(object);
    });
    canvas.on('object:modified', (event) => {
      if (isUpdatingFromYjsRef.current || !event.target) return;
      if (event.target.id && pendingCreationIdsRef.current.has(event.target.id)) return;
      persistModifiedObject(event.target);
      finishInteraction(event.target.id);
    });
    canvas.on('object:removed', (event) => {
      if (isUpdatingFromYjsRef.current || !event.target) return;
      const object = event.target;
      if (object.id && pendingCreationIdsRef.current.delete(object.id)) {
        objectIndexRef.current.delete(object.id);
        lastKnownObjectsRef.current.delete(object.id);
        return;
      }
      removeObject(object);
      finishInteraction(object.id);
    });
    canvas.on('before:transform', (event: any) => {
      const target = event.transform?.target as fabric.Object | undefined;
      if (target && !beginInteraction(target)) event.transform.action = 'none';
    });
    ['object:moving', 'object:scaling', 'object:rotating'].forEach((eventName) => {
      canvas.on(eventName, (event: any) => {
        const target = event.target as fabric.Object | undefined;
        if (!target?.id) return;
        if (!activeInteractionIdsRef.current.has(target.id) && !beginInteraction(target, false)) return;
        collaborationRef.current?.refreshLock(target.id);
      });
    });
    canvas.on('text:editing:entered', (event: any) => {
      const object = event.target as fabric.Object | undefined;
      if (!object?.id) return;
      if (!beginInteraction(object)) {
        (object as any).exitEditing?.();
        return;
      }
      editingBeforeRef.current.set(object.id, cloneSerialized(serialize(object)));
    });
    canvas.on('text:editing:exited', (event: any) => {
      const object = event.target as fabric.Object | undefined;
      if (!object?.id || isUpdatingFromYjsRef.current) return;
      const isDraft = pendingCreationIdsRef.current.has(object.id);
      const text = String((object as any).text ?? '').trim();
      if (isDraft) {
        if (!text || text === DEFAULT_TEXT || text === DEFAULT_STICKY_TEXT) {
          historySuspendedRef.current = true;
          canvas.remove(object);
          historySuspendedRef.current = false;
        } else {
          pendingCreationIdsRef.current.delete(object.id);
          commitNewObject(object);
        }
      } else {
        const before = editingBeforeRef.current.get(object.id) ?? lastKnownObjectsRef.current.get(object.id);
        const after = cloneSerialized(serialize(object));
        if (!before || !snapshotsMatch(before, after)) persistModifiedObject(object);
      }
      editingBeforeRef.current.delete(object.id);
      finishInteraction(object.id);
    });
    canvas.on('object:scaled', (event) => {
      const object = event.target as fabric.Textbox | undefined;
      if (!object || object.type !== 'textbox' || !(object as any)._isSticky) return;
      const scale = Math.max(object.scaleX ?? 1, object.scaleY ?? 1);
      if (Math.abs(scale - 1) < 0.005) return;
      const newWidth = Math.max(80, Math.round((object.width ?? 220) * scale));
      (object as any)._stickyScale = ((object as any)._stickyScale ?? 1) * scale;
      object.set({ width: newWidth, scaleX: 1, scaleY: 1 });
      object.setCoords();
      canvas.fire('object:modified', { target: object });
      canvas.requestRenderAll();
    });
    const updateSelection = () => {
      const object = canvas.getActiveObject();
      if (object?.id && isLockedByCollaborator(object.id)) {
        canvas.discardActiveObject();
        toast.info('Locked while a collaborator is editing this object');
      }
      setIsStickySelected(!!(object && object.type === 'textbox'));
    };
    canvas.on('selection:created', updateSelection);
    canvas.on('selection:updated', updateSelection);
    canvas.on('selection:cleared', () => setIsStickySelected(false));

    canvas.on('mouse:down', (event) => {
      const { activeTool: tool, strokeColor: stroke, fillColor: fill, strokeWidth: width, fontSize: size, userId: creator } = stateRef.current;
      if (tool === 'select') {
        const target = event.target as fabric.Object | undefined;
        if (target) beginInteraction(target, false);
        return;
      }
      const pointer = canvas.getPointer(event.e);
      if (tool === 'brush') return;
      if (tool === 'rectangle' || tool === 'circle') {
        isCreatingShapeRef.current = true;
        startPointerRef.current = pointer;
        const shape = tool === 'rectangle'
          ? new fabric.Rect({ left: pointer.x, top: pointer.y, width: 0, height: 0, stroke, fill, strokeWidth: width, selectable: false, hasControls: false, id: createId(), creatorId: creator })
          : new fabric.Circle({ left: pointer.x, top: pointer.y, radius: 0, stroke, fill, strokeWidth: width, selectable: false, hasControls: false, id: createId(), creatorId: creator });
        pendingCreationIdsRef.current.add(shape.id!);
        activeShapeRef.current = shape;
        canvas.add(shape);
        canvas.setActiveObject(shape);
        return;
      }
      const isSticky = tool === 'sticky';
      const object = isSticky
        ? new fabric.Textbox(DEFAULT_STICKY_TEXT, {
          left: pointer.x, top: pointer.y, width: 220, fontSize: 16, fontFamily: 'Inter, sans-serif', fill: '#1e293b', backgroundColor: '#fef08a', padding: 20, splitByGrapheme: false, lockScalingFlip: true,
          shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.1)', blur: 10, offsetX: 4, offsetY: 4 }), id: createId(), creatorId: creator,
        } as any)
        : new fabric.IText(DEFAULT_TEXT, { left: pointer.x, top: pointer.y, fill: stroke, fontSize: size, fontFamily: 'Inter, sans-serif', id: createId(), creatorId: creator });
      if (isSticky) {
        (object as any)._isSticky = true;
        (object as any)._stickyBaseFontSize = 16;
        (object as any)._stickyBaseWidth = 220;
        (object as any)._stickyScale = 1;
      }
      pendingCreationIdsRef.current.add(object.id!);
      canvas.add(object);
      canvas.setActiveObject(object);
      canvas.renderAll();
      window.setTimeout(() => {
        (object as any).enterEditing?.();
        (object as any).selectAll?.();
        canvas.requestRenderAll();
      }, 0);
      setActiveTool('select');
    });
    canvas.on('mouse:move', (event) => {
      if (!isCreatingShapeRef.current || !startPointerRef.current || !activeShapeRef.current) return;
      const pointer = canvas.getPointer(event.e);
      const start = startPointerRef.current;
      const shape = activeShapeRef.current;
      if (shape.type === 'rect') {
        shape.set({ left: Math.min(start.x, pointer.x), top: Math.min(start.y, pointer.y), width: Math.abs(start.x - pointer.x), height: Math.abs(start.y - pointer.y) });
      } else if (shape.type === 'circle') {
        const radius = Math.max(Math.abs(start.x - pointer.x), Math.abs(start.y - pointer.y)) / 2;
        (shape as fabric.Circle).set({ left: start.x + (pointer.x > start.x ? 0 : -radius * 2), top: start.y + (pointer.y > start.y ? 0 : -radius * 2), radius });
      }
      shape.setCoords();
      canvas.requestRenderAll();
    });
    canvas.on('mouse:up', () => {
      if (isCreatingShapeRef.current) {
        const shape = activeShapeRef.current;
        if (shape) {
          const tooSmall = (shape.type === 'rect' && ((shape.width ?? 0) < 5 || (shape.height ?? 0) < 5)) ||
            (shape.type === 'circle' && ((shape as fabric.Circle).radius ?? 0) < 3);
          if (tooSmall) {
            historySuspendedRef.current = true;
            canvas.remove(shape);
            historySuspendedRef.current = false;
          } else {
            pendingCreationIdsRef.current.delete(shape.id!);
            shape.set({ selectable: true, hasControls: true });
            shape.setCoords();
            commitNewObject(shape);
          }
        }
        activeShapeRef.current = null;
        startPointerRef.current = null;
        isCreatingShapeRef.current = false;
      }
      const active = canvas.getActiveObject();
      if (active?.id && !(active as any).isEditing) finishInteraction(active.id);
      canvas.requestRenderAll();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const active = canvas.getActiveObject();
      const editing = !!(active && (active as any).isEditing);
      if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (!editing && (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        void exportPng();
        return;
      }
      if (!editing && event.key === 'Escape') {
        if (active?.id) finishInteraction(active.id);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
      }
      if (!editing && (event.key === 'Delete' || event.key === 'Backspace')) {
        canvas.getActiveObjects().forEach((object) => {
          if (!isLockedByCollaborator(object.id)) canvas.remove(object);
        });
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
      }
      if (!editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const shortcuts: Record<string, typeof activeTool> = { v: 'select', d: 'brush', r: 'rectangle', c: 'circle', t: 'text', n: 'sticky' };
        const tool = shortcuts[event.key.toLowerCase()];
        if (tool) setActiveTool(tool);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const observer = (event: any) => {
      if (event.transaction.local) return;
      event.keys.forEach((change: { action: 'add' | 'update' | 'delete' }, key: string) => {
        if (change.action === 'delete') applyRemoteDelete(key);
        else {
          const value = canvasObjectsMap?.get(key);
          if (value) applyRemoteObject(key, value);
        }
      });
      canvas.requestRenderAll();
    };
    if (canvasObjectsMap) {
      canvasObjectsMap.observe(observer);
      canvasObjectsMap.forEach((value: SerializedCanvasObject, key: string) => applyRemoteObject(key, value));
    }

    reconcileLocksRef.current = applyInteractivity;
    applyInteractivity();
    return () => {
      window.removeEventListener('resize', updateCanvasSize);
      window.removeEventListener('keydown', handleKeyDown);
      resizeObserver?.disconnect();
      if (canvasObjectsMap) canvasObjectsMap.unobserve(observer);
      collaborationRef.current?.releaseLock();
      reconcileLocksRef.current = null;
      canvas.dispose();
      fabricCanvasRef.current = null;
      objectIndexRef.current.clear();
      lastKnownObjectsRef.current.clear();
      historyPastRef.current = [];
      historyFutureRef.current = [];
      syncHistoryState();
      registerCanvasController?.(null);
      registerCanvasRef?.(null);
    };
  }, [canvasObjectsMap]);

  useEffect(() => {
    reconcileLocksRef.current?.();
  }, [collaboration?.locks, activeTool]);

  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = activeTool === 'brush';
    if (canvas.isDrawingMode) {
      if (!canvas.freeDrawingBrush) canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = strokeColor;
      canvas.freeDrawingBrush.width = strokeWidth;
    }
    canvas.requestRenderAll();
  }, [activeTool, strokeColor, strokeWidth]);

  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const background = theme === 'light' ? '#ffffff' : '#000000';
    canvas.setBackgroundColor(background, canvas.requestRenderAll.bind(canvas));
    historySuspendedRef.current = true;
    canvas.getObjects().forEach((object) => {
      let changed = false;
      if (object.type === 'path' || object.type === 'rect' || object.type === 'circle') {
        const stroke = swapThemeColor(object.stroke as string, theme);
        const fill = object.fill !== 'transparent' ? swapThemeColor(object.fill as string, theme) : null;
        if (stroke) { object.set('stroke', stroke); changed = true; }
        if (fill) { object.set('fill', fill); changed = true; }
      } else if (object.type === 'i-text') {
        const fill = swapThemeColor(object.fill as string, theme);
        if (fill) { object.set('fill', fill); changed = true; }
      }
      if (changed && object.id && canvasObjectsMap) {
        object.setCoords();
        canvasObjectsMap.set(object.id, object.toObject([...CUSTOM_FABRIC_PROPS]));
        lastKnownObjectsRef.current.set(object.id, cloneSerialized(object.toObject([...CUSTOM_FABRIC_PROPS])));
      }
    });
    historySuspendedRef.current = false;
    canvas.requestRenderAll();
  }, [theme, canvasObjectsMap]);

  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active || !active.id || collaborationRef.current?.locks[active.id]) return;
    let changed = false;
    if (active.type === 'textbox') {
      if ((active as any).fontSize !== fontSize) { active.set('fontSize' as any, fontSize); changed = true; }
    } else if (active.type === 'i-text') {
      if (active.fill !== strokeColor) { active.set('fill', strokeColor); changed = true; }
      if ((active as any).fontSize !== fontSize) { active.set('fontSize' as any, fontSize); changed = true; }
    } else {
      if (active.stroke !== strokeColor) { active.set('stroke', strokeColor); changed = true; }
      if (active.fill !== fillColor) { active.set('fill', fillColor); changed = true; }
      if (active.strokeWidth !== strokeWidth) { active.set('strokeWidth', strokeWidth); changed = true; }
    }
    if (changed) {
      active.setCoords();
      canvas.fire('object:modified', { target: active });
      canvas.requestRenderAll();
    }
  }, [strokeColor, fillColor, strokeWidth, fontSize]);

  return <div ref={wrapperRef} className="canvas-wrapper"><canvas ref={canvasRef} id="fabric-canvas" /></div>;
};
