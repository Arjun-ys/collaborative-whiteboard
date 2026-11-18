import React, { useEffect, useRef, useState } from 'react';
import { fabric } from 'fabric';
import { useStore } from '../store/useStore';
import { CUSTOM_FABRIC_PROPS } from '../utils/fabricHelpers';
import { canonicalSnapshot, snapshotForTheme, cloneSnapshot as cloneSerialized, snapshotsMatch } from '../utils/canvasSnapshots';
import type * as Y from 'yjs';
import { createId } from '../utils/id';
import { logger } from '../utils/logger';
import { confirmDialog, toast } from '../utils/notifications';
import type { CollaborationController } from '../types/collaboration';
import type { CanvasControllerRegistration, SerializedCanvasObject } from '../types/whiteboard';
import { createViewport, exportCanvasPng } from '../utils/viewport';
import { collaboratorColor } from '../utils/presence';
import { validateObject } from '../utils/validateObject';

type ObjectChange = { objectId: string; before?: SerializedCanvasObject; after?: SerializedCanvasObject };
type HistoryEntry = { changes: ObjectChange[] };

interface WhiteboardProps {
  canvasObjectsMap?: Y.Map<SerializedCanvasObject>;
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
  const refreshThemeRef = useRef<(() => void) | null>(null);
  const navigationRef = useRef<ReturnType<typeof createViewport> | null>(null);
  const refreshPresenceRef = useRef<(() => void) | null>(null);
  const [presenceMarks, setPresenceMarks] = useState<Array<{ key: string; name: string; color: string; left: number; top: number; width?: number; height?: number }>>([]);
  const callbacksRef = useRef({ onLocalObjectAdded, onLocalObjectModified, onLocalObjectRemoved, registerCanvasRef, registerCanvasController });
  useEffect(() => {
    callbacksRef.current = { onLocalObjectAdded, onLocalObjectModified, onLocalObjectRemoved, registerCanvasRef, registerCanvasController };
  }, [onLocalObjectAdded, onLocalObjectModified, onLocalObjectRemoved, registerCanvasRef, registerCanvasController]);

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
    setSelectionProperties,
    propertyRevision,
    setZoom,
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
    if (!canvasRef.current || !canvasObjectsMap) return;
    let disposed = false;
    let clearing = false;
    const objectIndex = objectIndexRef.current;
    const lastKnown = lastKnownObjectsRef.current;
    const drafts = pendingCreationIdsRef.current;
    const editingBefore = editingBeforeRef.current;
    const interactions = activeInteractionIdsRef.current;
    const remoteQueue = pendingRemoteRef.current;

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
    callbacksRef.current.registerCanvasRef?.(canvas);
    const navigation = createViewport(canvas, () => stateRef.current.activeTool, () => {
      setZoom(canvas.getZoom());
      refreshPresenceRef.current?.();
    });
    navigationRef.current = navigation;
    setZoom(1);

    const serialize = (object: fabric.Object) => canonicalSnapshot(object.toObject([...CUSTOM_FABRIC_PROPS]));
    const viewSnapshot = (value: SerializedCanvasObject) => snapshotForTheme(value, stateRef.current.theme);
    const membersOf = (object: fabric.Object) => object.type === 'activeSelection'
      ? (object as fabric.ActiveSelection).getObjects() : [object];
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
      setHistoryState({ canUndo: !historyReplayRef.current && historyPastRef.current.length > 0, canRedo: !historyReplayRef.current && historyFutureRef.current.length > 0 });
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
      if (active && membersOf(active).some((member) => isLockedByCollaborator(member.id))) {
        canvas.discardActiveObject();
        membersOf(active).forEach((member) => {
          finishInteraction(member.id);
          const latest = member.id && canvasObjectsMap.get(member.id);
          if (latest && member.id) applyRemoteObject(member.id, latest);
        });
      }
      canvas.requestRenderAll();
    };

    const commitNewObject = (object: fabric.Object) => {
      if (!object.id) object.id = createId();
      if (!object.creatorId) object.creatorId = stateRef.current.userId;
      objectIndexRef.current.set(object.id, object);
      const snapshot = cloneSerialized(serialize(object));
      recordHistory({ changes: [{ objectId: object.id, after: snapshot }] });
      rememberSerialized(object.id, snapshot);
      if (canvasObjectsMap) canvasObjectsMap.set(object.id, snapshot);
      callbacksRef.current.onLocalObjectAdded?.(object);
    };
    const persistModifiedObject = (object: fabric.Object) => {
      if (!object.id) return;
      if (pendingRemoteRef.current.has(object.id) ||
          (!pendingCreationIdsRef.current.has(object.id) && !canvasObjectsMap.has(object.id))) {
        finishInteraction(object.id);
        const latest = canvasObjectsMap.get(object.id);
        if (latest) applyRemoteObject(object.id, latest);
        else applyRemoteDelete(object.id);
        toast.info('A collaborator changed this object; their latest edit was kept');
        return;
      }
      if (isLockedByCollaborator(object.id)) {
        const latest = canvasObjectsMap?.get(object.id);
        if (latest) applyRemoteObject(object.id, latest);
        toast.warning('This object is being edited by a collaborator');
        return;
      }
      const before = lastKnownObjectsRef.current.get(object.id);
      const after = cloneSerialized(serialize(object));
      if (before && !snapshotsMatch(before, after)) {
        recordHistory({ changes: [{ objectId: object.id, before: cloneSerialized(before), after }] });
      }
      rememberSerialized(object.id, after);
      if (canvasObjectsMap) canvasObjectsMap.set(object.id, after);
      callbacksRef.current.onLocalObjectModified?.(object);
    };
    const removeObject = (object: fabric.Object) => {
      if (!object.id) return;
      const before = lastKnownObjectsRef.current.get(object.id);
      if (before) recordHistory({ changes: [{ objectId: object.id, before: cloneSerialized(before) }] });
      objectIndexRef.current.delete(object.id);
      lastKnownObjectsRef.current.delete(object.id);
      if (canvasObjectsMap) canvasObjectsMap.delete(object.id);
      callbacksRef.current.onLocalObjectRemoved?.(object);
    };

    const enlivenObject = (value: SerializedCanvasObject, onReady: (object: fabric.Object | null) => void) => {
      const safeValue = validateObject(value, String(value.id ?? ''));
      if (!safeValue) { onReady(null); return; }
      fabric.util.enlivenObjects([safeValue], (objects: fabric.Object[]) => onReady(objects[0] ?? null), 'fabric');
    };
    const applyRemoteObject = (objectId: string, value: SerializedCanvasObject) => {
      const safeValue = validateObject(value, objectId);
      if (!safeValue) {
        applyRemoteDelete(objectId);
        return;
      }
      if (activeInteractionIdsRef.current.has(objectId)) {
        pendingRemoteRef.current.set(objectId, cloneSerialized(value));
        return;
      }
      const existing = findById(objectId);
      if (existing) {
        withRemoteUpdate(() => {
          // Detach multi-selection before applying world-space coordinates.
          if (existing.group?.type === 'activeSelection') canvas.discardActiveObject();
          existing.set(viewSnapshot(safeValue));
          updateStickyMetadata(existing, value);
          existing.setCoords();
          rememberSerialized(objectId, value);
        });
        applyInteractivity();
        return;
      }
      enlivenObject(viewSnapshot(safeValue), (newObject) => {
        if (!newObject || disposed) return;
        const latest = canvasObjectsMap?.get(objectId) as SerializedCanvasObject | undefined;
        if (!latest || !snapshotsMatch(latest, value)) {
          if (latest) applyRemoteObject(objectId, latest);
          return;
        }
        withRemoteUpdate(() => {
          const duplicate = findById(objectId);
          if (duplicate) {
            duplicate.set(viewSnapshot(safeValue));
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
        pendingRemoteRef.current.set(objectId, null);
        const editing = findById(objectId) as fabric.IText | undefined;
        if (editing?.isEditing) withRemoteUpdate(() => editing.exitEditing());
        finishInteraction(objectId);
        return;
      }
      const existing = findById(objectId);
      if (!existing) return;
      const selected = canvas.getActiveObject();
      const interruptedMembers = selected && membersOf(selected).some((member) => member.id === objectId)
        ? membersOf(selected) : [];
      withRemoteUpdate(() => {
        if (existing.group?.type === 'activeSelection' || canvas.getActiveObject() === existing) canvas.discardActiveObject();
        objectIndexRef.current.delete(objectId);
        lastKnownObjectsRef.current.delete(objectId);
        canvas.remove(existing);
      });
      interruptedMembers.forEach((member) => finishInteraction(member.id));
      canvas.requestRenderAll();
    };
    const finishInteraction = (objectId?: string) => {
      if (!objectId) return;
      activeInteractionIdsRef.current.delete(objectId);
      collaborationRef.current?.releaseLock(objectId);
      const hadPending = pendingRemoteRef.current.has(objectId);
      pendingRemoteRef.current.delete(objectId);
      if (hadPending) {
        const latest = canvasObjectsMap.get(objectId);
        if (latest) applyRemoteObject(objectId, latest);
        else applyRemoteDelete(objectId);
      }
    };
    const beginInteraction = (object: fabric.Object, announceFailure = true) => {
      const members = membersOf(object);
      const ids = members.map((member) => member.id).filter((id): id is string => !!id);
      if (!ids.length) return false;
      if (ids.some(isLockedByCollaborator) || (collaborationRef.current && !collaborationRef.current.claimLocks(ids))) {
        if (announceFailure) toast.info('Locked while a collaborator is editing this object');
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return false;
      }
      ids.forEach((id) => activeInteractionIdsRef.current.add(id));
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
      if (clearing || historyReplayRef.current) return;
      clearing = true;
      let confirmed: boolean;
      try { confirmed = await confirmDialog('Are you sure you want to clear the entire canvas?'); }
      finally { clearing = false; }
      if (!confirmed) return;
      if (disposed || historyReplayRef.current) return;
      canvas.discardActiveObject();
      const objects = Array.from(canvasObjectsMap.entries()).filter(([id, value]) => validateObject(value, id)).map(([, value]) => cloneSerialized(value));
      historySuspendedRef.current = true;
      withRemoteUpdate(() => {
        if (canvasObjectsMap) {
          canvasObjectsMap.doc!.transact(() => canvasObjectsMap.forEach((_: unknown, key: string) => canvasObjectsMap.delete(key)));
        }
        canvas.clear();
        canvas.setBackgroundColor(stateRef.current.theme === 'light' ? '#ffffff' : '#000000', canvas.renderAll.bind(canvas));
        objectIndexRef.current.clear();
        lastKnownObjectsRef.current.clear();
        pendingCreationIdsRef.current.clear();
        pendingRemoteRef.current.clear();
        activeInteractionIdsRef.current.clear();
        collaborationRef.current?.releaseLock();
      });
      historySuspendedRef.current = false;
      if (objects.length) recordHistory({ changes: objects.filter((object) => object.id).map((object) => ({ objectId: object.id, before: object })) });
    };

    const exportPng = async () => {
      const dataUrl = await exportCanvasPng(canvas);
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

    const applyHistoryEntry = async (entry: HistoryEntry, direction: 'undo' | 'redo') => {
      const changes = entry.changes.map((change) => ({
        ...change,
        expected: direction === 'undo' ? change.after : change.before,
        target: direction === 'undo' ? change.before : change.after,
      }));
      const canApply = () => !disposed && changes.every((change) =>
        !isLockedByCollaborator(change.objectId) &&
        snapshotsMatch(canvasObjectsMap.get(change.objectId), change.expected));
      if (!canApply()) return false;
      const restored = await Promise.all(changes.map((change) => new Promise<fabric.Object | null>((resolve) => {
        if (!change.target || findById(change.objectId)) resolve(null);
        else enlivenObject(viewSnapshot(change.target), resolve);
      })));
      // Enlivening may be asynchronous. Recheck all members before committing.
      if (!canApply() || changes.some((change, index) => change.target && !findById(change.objectId) && !restored[index])) return false;
      withRemoteUpdate(() => {
        canvas.discardActiveObject();
        canvasObjectsMap.doc!.transact(() => {
          changes.forEach((change, index) => {
            const existing = findById(change.objectId);
            if (!change.target) {
              if (existing) canvas.remove(existing);
              objectIndexRef.current.delete(change.objectId);
              lastKnownObjectsRef.current.delete(change.objectId);
              canvasObjectsMap.delete(change.objectId);
              return;
            }
            const object = existing ?? restored[index]!;
            object.id = change.objectId;
            object.set(viewSnapshot(change.target));
            updateStickyMetadata(object, change.target);
            object.setCoords();
            if (!existing) canvas.add(object);
            objectIndexRef.current.set(change.objectId, object);
            rememberSerialized(change.objectId, change.target);
            canvasObjectsMap.set(change.objectId, cloneSerialized(change.target));
          });
        });
      });
      applyInteractivity();
      return true;
    };
    const replayHistory = async (direction: 'undo' | 'redo') => {
      if (historyReplayRef.current || activeInteractionIdsRef.current.size > 0) return;
      const from = direction === 'undo' ? historyPastRef.current : historyFutureRef.current;
      const to = direction === 'undo' ? historyFutureRef.current : historyPastRef.current;
      const entry = from.pop();
      if (!entry) return;
      historyReplayRef.current = true;
      syncHistoryState();
      try {
        const applied = await applyHistoryEntry(entry, direction);
        if (disposed) return;
        if (applied) to.push(entry);
        else toast.info('History skipped because a collaborator changed or locked an object');
      } finally {
        if (!disposed) {
          historyReplayRef.current = false;
          syncHistoryState();
        }
      }
    };
    const undo = () => { void replayHistory('undo'); };
    const redo = () => { void replayHistory('redo'); };
    callbacksRef.current.registerCanvasController?.({ undo, redo, exportPng, clear: clearCanvas,
      zoomIn: () => navigation.zoomBy(1.25), zoomOut: () => navigation.zoomBy(0.8),
      resetView: navigation.reset, fitToContent: navigation.fit });
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
      const members = membersOf(event.target);
      const grouped = event.target.type === 'activeSelection';
      const before = members.map((member) => member.id && lastKnownObjectsRef.current.get(member.id));
      if (grouped) canvas.discardActiveObject();
      if (grouped && members.some((member, index) => !member.id ||
          isLockedByCollaborator(member.id) || pendingRemoteRef.current.has(member.id) ||
          !snapshotsMatch(canvasObjectsMap.get(member.id), before[index] || undefined))) {
        members.forEach((member) => {
          finishInteraction(member.id);
          if (!member.id) return;
          const latest = canvasObjectsMap.get(member.id);
          if (latest) applyRemoteObject(member.id, latest);
          else applyRemoteDelete(member.id);
        });
        toast.info('Group edit cancelled because a collaborator changed an object');
        return;
      }
      // Fabric 5 emits modified, not scaled, at completion. Preserve the
      // project's sticky override and run it before committing the snapshot.
      members.forEach((member) => canvas.fire('object:scaled', { target: member }));
      if (grouped) historySuspendedRef.current = true;
      try {
        canvasObjectsMap.doc!.transact(() => members.forEach((member) => {
          persistModifiedObject(member);
          finishInteraction(member.id);
        }));
      } finally { if (grouped) historySuspendedRef.current = false; }
      if (grouped) {
        const changes: ObjectChange[] = [];
        members.forEach((member, index) => {
          if (!member.id || !before[index]) return;
          const after = canvasObjectsMap.get(member.id);
          if (after && !snapshotsMatch(before[index] as SerializedCanvasObject, after)) {
            changes.push({ objectId: member.id, before: before[index] as SerializedCanvasObject, after: cloneSerialized(after) });
          }
        });
        if (changes.length) recordHistory({ changes });
      }
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
      if (isUpdatingFromYjsRef.current) return;
      const target = event.transform?.target as fabric.Object | undefined;
      if (target && !beginInteraction(target)) event.transform.action = 'none';
    });
    ['object:moving', 'object:scaling', 'object:rotating'].forEach((eventName) => {
      canvas.on(eventName, (event: any) => {
        if (isUpdatingFromYjsRef.current) return;
        const target = event.target as fabric.Object | undefined;
        if (!target) return;
        const members = membersOf(target);
        if (members.some((member) => member.id && !activeInteractionIdsRef.current.has(member.id)) && !beginInteraction(target, false)) return;
        if (members[0]?.id) collaborationRef.current?.refreshLock(members[0].id);
      });
    });
    canvas.on('text:editing:entered', (event: any) => {
      if (isUpdatingFromYjsRef.current) return;
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
      if (isUpdatingFromYjsRef.current) return;
      const object = event.target as fabric.Textbox | undefined;
      if (!object || object.type !== 'textbox' || !(object as any)._isSticky) return;
      const scale = Math.max(object.scaleX ?? 1, object.scaleY ?? 1);
      if (Math.abs(scale - 1) < 0.005) return;
      const newWidth = Math.max(80, Math.round((object.width ?? 220) * scale));
      (object as any)._stickyScale = ((object as any)._stickyScale ?? 1) * scale;
      object.set({ width: newWidth, scaleX: 1, scaleY: 1 });
      object.setCoords();
      canvas.requestRenderAll();
    });
    const updateSelection = () => {
      const object = canvas.getActiveObject();
      if (object?.id && isLockedByCollaborator(object.id)) {
        canvas.discardActiveObject();
        toast.info('Locked while a collaborator is editing this object');
      }
      setIsStickySelected(!!(object && object.type === 'textbox'));
      collaborationRef.current?.publishSelection?.(canvas.getActiveObjects().map((member) => member.id).filter((id): id is string => !!id));
      if (!object || object.type === 'activeSelection') {
        setSelectionProperties({ selectedObjectType: object?.type ?? null });
        return;
      }
      const text = object as fabric.IText;
      const isText = object.type === 'i-text' || object.type === 'textbox';
      setSelectionProperties({
        selectedObjectType: object.type ?? null,
        strokeColor: String(isText ? object.fill ?? '#1e293b' : object.stroke ?? stateRef.current.strokeColor),
        fillColor: String(object.fill ?? 'transparent'),
        strokeWidth: object.strokeWidth ?? stateRef.current.strokeWidth,
        ...(isText ? { fontSize: text.fontSize ?? stateRef.current.fontSize } : {}),
      });
    };
    canvas.on('selection:created', updateSelection);
    canvas.on('selection:updated', updateSelection);
    canvas.on('selection:cleared', () => {
      collaborationRef.current?.publishSelection?.([]);
      setIsStickySelected(false);
      setSelectionProperties({ selectedObjectType: null });
    });

    canvas.on('mouse:down', (event) => {
      if (isUpdatingFromYjsRef.current || historyReplayRef.current) return;
      if (navigation.isNavigating()) return;
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
          left: pointer.x, top: pointer.y, width: 220, fontSize: size, fontFamily: 'Inter, sans-serif', fill: '#1e293b', backgroundColor: '#fef08a', padding: 20, splitByGrapheme: false, lockScalingFlip: true,
          shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.1)', blur: 10, offsetX: 4, offsetY: 4 }), id: createId(), creatorId: creator,
        } as any)
        : new fabric.IText(DEFAULT_TEXT, { left: pointer.x, top: pointer.y, fill: stroke, fontSize: size, fontFamily: 'Inter, sans-serif', id: createId(), creatorId: creator });
      if (isSticky) {
        (object as any)._isSticky = true;
        (object as any)._stickyBaseFontSize = size;
        (object as any)._stickyBaseWidth = 220;
        (object as any)._stickyScale = 1;
      }
      pendingCreationIdsRef.current.add(object.id!);
      canvas.add(object);
      canvas.setActiveObject(object);
      canvas.renderAll();
      window.setTimeout(() => {
        if (disposed || !object.id || !objectIndexRef.current.has(object.id)) return;
        (object as any).enterEditing?.();
        (object as any).selectAll?.();
        canvas.requestRenderAll();
      }, 0);
      setActiveTool('select');
    });
    canvas.on('mouse:move', (event) => {
      if (isUpdatingFromYjsRef.current) return;
      const screenPointer = canvas.getPointer(event.e, true);
      const cursor = fabric.util.transformPoint(new fabric.Point(screenPointer.x, screenPointer.y), fabric.util.invertTransform(canvas.viewportTransform!));
      collaborationRef.current?.publishCursor?.({ x: cursor.x, y: cursor.y });
      if (navigation.isNavigating()) return;
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
      if (isUpdatingFromYjsRef.current) return;
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
      if (active && !(active as any).isEditing) membersOf(active).forEach((member) => finishInteraction(member.id));
      canvas.requestRenderAll();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const active = canvas.getActiveObject();
      const editing = !!(active && (active as any).isEditing);
      if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
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
        if (active) membersOf(active).forEach((member) => finishInteraction(member.id));
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
      }
      if (!editing && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        if (historyReplayRef.current) return;
        const selected = canvas.getActiveObjects();
        canvas.discardActiveObject();
        selected.forEach((object) => {
          if (!isLockedByCollaborator(object.id)) canvas.remove(object);
        });
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
      }
      if (!editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const shortcuts: Record<string, typeof activeTool> = { v: 'select', h: 'pan', d: 'brush', r: 'rectangle', c: 'circle', t: 'text', n: 'sticky' };
        const tool = shortcuts[event.key.toLowerCase()];
        if (tool) setActiveTool(tool);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const observer = (event: Y.YMapEvent<SerializedCanvasObject>) => {
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
    const refreshPresence = () => {
      if (disposed) return;
      const marks: typeof presenceMarks = [];
      const remote = collaborationRef.current;
      for (const peer of remote?.peers ?? []) {
        if (peer.cursor) {
          const point = fabric.util.transformPoint(new fabric.Point(peer.cursor.x, peer.cursor.y), canvas.viewportTransform!);
          if (point.x >= 0 && point.y >= 0 && point.x <= canvas.getWidth() && point.y <= canvas.getHeight()) {
            marks.push({ key: `cursor-${peer.clientId}`, name: peer.name, color: peer.color, left: point.x, top: point.y });
          }
        }
        for (const id of peer.selectedIds) {
          if (remote?.locks[id]) continue;
          const object = objectIndex.get(id);
          if (!object) continue;
          const bounds = object.getBoundingRect(false, true);
          marks.push({ key: `selection-${peer.clientId}-${id}`, name: peer.name, color: peer.color, ...bounds });
        }
      }
      for (const lease of Object.values(remote?.locks ?? {})) {
        if (remote?.isLockOwnedByCurrentUser(lease.objectId)) continue;
        const object = objectIndex.get(lease.objectId);
        if (!object) continue;
        marks.push({ key: `lock-${lease.objectId}`, name: `${lease.ownerName} · editing`, color: collaboratorColor(lease.ownerClientId), ...object.getBoundingRect(false, true) });
      }
      setPresenceMarks(marks);
    };
    refreshPresenceRef.current = refreshPresence;
    canvas.on('after:render', refreshPresence);
    const leaveCanvas = () => collaborationRef.current?.publishCursor?.(null);
    canvas.getSelectionElement().addEventListener('mouseleave', leaveCanvas);
    refreshThemeRef.current = () => {
      withRemoteUpdate(() => {
        canvas.setBackgroundColor(stateRef.current.theme === 'light' ? '#ffffff' : '#000000', canvas.requestRenderAll.bind(canvas));
        canvas.getObjects().forEach((object) => {
          // Use the current view while dragging so changing theme does not
          // rewind a local transform. Color conversion never writes to Yjs.
          const view = viewSnapshot(serialize(object));
          object.set({ stroke: view.stroke, fill: view.fill });
        });
        if (canvas.getActiveObject()) updateSelection();
      });
      canvas.requestRenderAll();
    };
    const leaseRenewal = window.setInterval(() => {
      const id = activeInteractionIdsRef.current.values().next().value;
      if (id) collaborationRef.current?.refreshLock(id);
    }, 5000);
    applyInteractivity();
    return () => {
      disposed = true;
      navigation.dispose();
      navigationRef.current = null;
      refreshPresenceRef.current = null;
      canvas.getSelectionElement().removeEventListener('mouseleave', leaveCanvas);
      collaborationRef.current?.publishCursor?.(null);
      collaborationRef.current?.publishSelection?.([]);
      window.clearInterval(leaseRenewal);
      window.removeEventListener('resize', updateCanvasSize);
      window.removeEventListener('keydown', handleKeyDown);
      resizeObserver?.disconnect();
      if (canvasObjectsMap) canvasObjectsMap.unobserve(observer);
      collaborationRef.current?.releaseLock();
      reconcileLocksRef.current = null;
      refreshThemeRef.current = null;
      canvas.dispose();
      fabricCanvasRef.current = null;
      objectIndex.clear();
      lastKnown.clear();
      historyPastRef.current = [];
      historyFutureRef.current = [];
      drafts.clear();
      editingBefore.clear();
      interactions.clear();
      remoteQueue.clear();
      isCreatingShapeRef.current = false;
      activeShapeRef.current = null;
      startPointerRef.current = null;
      historyReplayRef.current = false;
      historySuspendedRef.current = false;
      syncHistoryState();
      callbacksRef.current.registerCanvasController?.(null);
      callbacksRef.current.registerCanvasRef?.(null);
    };
  }, [canvasObjectsMap, setActiveTool, setIsStickySelected, setHistoryState, setSelectionProperties, setZoom]);

  useEffect(() => {
    reconcileLocksRef.current?.();
    navigationRef.current?.configure();
  }, [collaboration?.locks, activeTool]);

  useEffect(() => { refreshPresenceRef.current?.(); }, [collaboration?.peers, collaboration?.locks]);

  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = activeTool === 'brush';
    if (canvas.isDrawingMode) {
      if (!canvas.freeDrawingBrush) canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = strokeColor;
      canvas.freeDrawingBrush.width = strokeWidth;
    }
    navigationRef.current?.configure();
    canvas.requestRenderAll();
  }, [activeTool, strokeColor, strokeWidth, canvasObjectsMap]);

  useEffect(() => {
    refreshThemeRef.current?.();
  }, [theme, canvasObjectsMap]);

  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    const active = canvas?.getActiveObject();
    const { strokeColor, fillColor, strokeWidth, fontSize } = stateRef.current;
    if (!canvas || !active || !active.id || historyReplayRef.current) return;
    const lease = collaborationRef.current?.locks[active.id];
    if (lease && !collaborationRef.current?.isLockOwnedByCurrentUser(active.id)) return;
    let changed = false;
    if (active.type === 'textbox') {
      if (active.fill !== strokeColor) { active.set('fill', strokeColor); changed = true; }
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
  // Only explicit inspector edits mutate objects. Selection hydration and
  // personal theme changes update controls without creating shared edits.
  }, [propertyRevision]);

  return <div ref={wrapperRef} className="canvas-wrapper"><canvas ref={canvasRef} id="fabric-canvas" />
    <div className="presence-overlay" aria-hidden="true">{presenceMarks.map((mark) =>
      <div key={mark.key} className={mark.width === undefined ? 'remote-cursor' : 'remote-selection'}
        style={{ left: mark.left, top: mark.top, width: mark.width, height: mark.height, color: mark.color, borderColor: mark.color }}>
        {mark.width === undefined && <svg width="18" height="22" viewBox="0 0 18 22"><path d="M1 1v17l5-4 4 7 3-2-4-7 7-1Z" fill="currentColor" stroke="white" strokeWidth="1" /></svg>}
        <span className="remote-label" style={{ backgroundColor: mark.color }}>{mark.name}</span>
      </div>)}</div>
  </div>;
};
