import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useStore } from '../store/useStore';
import type { CollaborationController, ObjectLease } from '../types/collaboration';
import { logger } from '../utils/logger';
import { resolveLeases } from '../utils/leases';
import type { SerializedCanvasObject } from '../types/whiteboard';
import { readCollaborators } from '../utils/presence';
import type { Collaborator } from '../types/collaboration';

const LEASE_DURATION_MS = 15_000;

const getWsUrl = (): string => {
  if (import.meta.env?.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (import.meta.env?.PROD) return `${protocol}//${window.location.host}`;
  return `${protocol}//${window.location.hostname}:5001`;
};

const isLeaseValid = (lease: ObjectLease, now: number) => lease.expiresAt > now;

export const useYjs = () => {
  const { roomId, setConnectionState, setActiveUsers, userName, userId } = useStore();
  const providerRef = useRef<WebsocketProvider | null>(null);
  const [session, setSession] = useState<{ roomId: string; doc: Y.Doc; provider: WebsocketProvider } | null>(null);
  const provider = session?.provider ?? null;
  const [locks, setLocks] = useState<Record<string, ObjectLease>>({});
  const locksRef = useRef<Record<string, ObjectLease>>({});
  const [peers, setPeers] = useState<Collaborator[]>([]);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const lastCursorSentRef = useRef(0);

  const rebuildLocks = useCallback(() => {
    const awareness = providerRef.current?.awareness;
    if (!awareness) {
      locksRef.current = {};
      setLocks({});
      return;
    }

    const next = resolveLeases(awareness.getStates());
    locksRef.current = next;
    setLocks((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    setPeers(readCollaborators(awareness.getStates(), awareness.clientID));
  }, []);

  useEffect(() => {
    if (!roomId) return;
    const yDoc = new Y.Doc();
    const wsProvider = new WebsocketProvider(getWsUrl(), roomId, yDoc);
    providerRef.current = wsProvider;
    // oxlint-disable-next-line react/set-state-in-effect -- The room session is created and disposed with the external provider.
    setSession({ roomId, doc: yDoc, provider: wsProvider });
    setConnectionState('connecting');

    const statusHandler = (event: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      if (event.status === 'connected') setConnectionState(wsProvider.synced ? 'synced' : 'connecting');
      else if (event.status === 'connecting') setConnectionState('connecting');
      else setConnectionState('reconnecting');
    };
    const syncHandler = (synced: boolean) => setConnectionState(synced ? 'synced' : 'connecting');
    const connectionErrorHandler = () => setConnectionState('offline');

    const awareness = wsProvider.awareness;
    awareness.setLocalStateField('user', { id: userId, name: useStore.getState().userName });
    const awarenessHandler = () => {
      setActiveUsers(awareness.getStates().size || 1);
      rebuildLocks();
    };

    wsProvider.on('status', statusHandler);
    wsProvider.on('sync', syncHandler);
    wsProvider.on('connection-error', connectionErrorHandler);
    awareness.on('update', awarenessHandler);
    awarenessHandler();
    const leaseExpiryTimer = window.setInterval(rebuildLocks, 1000);

    logger.log(`[Yjs] Connecting to ${getWsUrl()} for room ${roomId}...`);
    return () => {
      window.clearInterval(leaseExpiryTimer);
      clearTimeout(cursorTimerRef.current);
      cursorTimerRef.current = undefined;
      cursorRef.current = null;
      lastCursorSentRef.current = 0;
      awareness.setLocalStateField('locks', []);
      wsProvider.off('status', statusHandler);
      wsProvider.off('sync', syncHandler);
      wsProvider.off('connection-error', connectionErrorHandler);
      awareness.off('update', awarenessHandler);
      wsProvider.destroy();
      awareness.destroy();
      providerRef.current = null;
      setSession(null);
      yDoc.destroy();
      setLocks({});
      locksRef.current = {};
      setPeers([]);
      setActiveUsers(1);
      setConnectionState('offline');
    };
  }, [roomId, rebuildLocks, setActiveUsers, setConnectionState, userId]);

  useEffect(() => {
    provider?.awareness.setLocalStateField('user', { id: userId, name: userName });
  }, [userId, userName, provider]);

  const getLocalLeases = (): ObjectLease[] => providerRef.current?.awareness.getLocalState()?.locks ?? [];

  const publishCursor = useCallback((cursor: { x: number; y: number } | null) => {
    cursorRef.current = cursor;
    const send = () => {
      cursorTimerRef.current = undefined;
      const awareness = providerRef.current?.awareness;
      if (!awareness) return;
      lastCursorSentRef.current = Date.now();
      awareness.setLocalStateField('presence', {
        ...awareness.getLocalState()?.presence,
        cursor: cursorRef.current ? { ...cursorRef.current, updatedAt: Date.now() } : null,
      });
    };
    if (!cursor || Date.now() - lastCursorSentRef.current >= 40) {
      clearTimeout(cursorTimerRef.current);
      send();
    } else cursorTimerRef.current ??= setTimeout(send, 40);
  }, []);

  const publishSelection = useCallback((selectedIds: string[]) => {
    const awareness = providerRef.current?.awareness;
    awareness?.setLocalStateField('presence', { ...awareness.getLocalState()?.presence, selectedIds });
  }, []);

  const claimLocks = useCallback((objectIds: string[]) => {
    const currentProvider = providerRef.current;
    if (!currentProvider) return false;
    const ids = [...new Set(objectIds)];
    if (ids.some((id) => {
      const active = locksRef.current[id];
      return active && active.ownerClientId !== currentProvider.awareness.clientID && isLeaseValid(active, Date.now());
    })) return false;
    const existing = getLocalLeases();
    const leases: ObjectLease[] = ids.map((objectId) => ({
      objectId,
      ownerClientId: currentProvider.awareness.clientID,
      ownerUserId: userId,
      ownerName: userName || 'Collaborator',
      claimedAt: existing.find((lease) => lease.objectId === objectId)?.claimedAt ?? Date.now(),
      expiresAt: Date.now() + LEASE_DURATION_MS,
    }));
    currentProvider.awareness.setLocalStateField('locks', leases);
    rebuildLocks();
    return true;
  }, [rebuildLocks, userId, userName]);

  const claimLock = useCallback((objectId: string) => claimLocks([objectId]), [claimLocks]);

  const refreshLock = useCallback((objectId: string) => {
    const leases = getLocalLeases();
    if (!leases.some((lease) => lease.objectId === objectId)) return false;
    return claimLocks(leases.map((lease) => lease.objectId));
  }, [claimLocks]);

  const releaseLock = useCallback((objectId?: string) => {
    const currentProvider = providerRef.current;
    if (!currentProvider) return;
    const remaining = objectId ? getLocalLeases().filter((lease) => lease.objectId !== objectId) : [];
    currentProvider.awareness.setLocalStateField('locks', remaining);
    rebuildLocks();
  }, [rebuildLocks]);

  const isLockOwnedByCurrentUser = useCallback((objectId: string) => {
    const currentProvider = providerRef.current;
    const lease = locksRef.current[objectId];
    return !!currentProvider && !!lease && lease.ownerClientId === currentProvider.awareness.clientID && isLeaseValid(lease, Date.now());
  }, []);

  const collaboration = useMemo<CollaborationController>(() => ({
    locks,
    claimLock,
    claimLocks,
    refreshLock,
    releaseLock,
    isLockOwnedByCurrentUser,
    peers, publishCursor, publishSelection,
  }), [locks, claimLock, claimLocks, refreshLock, releaseLock, isLockOwnedByCurrentUser, peers, publishCursor, publishSelection]);

  return {
    yDoc: session?.doc,
    canvasObjectsMap: session?.roomId === roomId && !session.doc.isDestroyed
      ? session.doc.getMap<SerializedCanvasObject>('canvas-objects') : undefined,
    provider,
    collaboration,
  };
};
