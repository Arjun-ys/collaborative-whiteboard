import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useStore } from '../store/useStore';
import type { CollaborationController, ObjectLease } from '../types/collaboration';
import { logger } from '../utils/logger';

const LEASE_DURATION_MS = 15_000;

const getWsUrl = (): string => {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:5001`;
};

const isLeaseValid = (lease: ObjectLease, now: number) => lease.expiresAt > now;

const isEarlierLease = (candidate: ObjectLease, current: ObjectLease) =>
  candidate.claimedAt < current.claimedAt ||
  (candidate.claimedAt === current.claimedAt && candidate.ownerClientId < current.ownerClientId);

export const useYjs = () => {
  const { roomId, setConnectionState, setActiveUsers, userName, userId } = useStore();
  const yDocRef = useRef<Y.Doc>(new Y.Doc());
  const providerRef = useRef<WebsocketProvider | null>(null);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [locks, setLocks] = useState<Record<string, ObjectLease>>({});

  const rebuildLocks = useCallback(() => {
    const awareness = providerRef.current?.awareness;
    if (!awareness) {
      setLocks({});
      return;
    }

    const now = Date.now();
    const next: Record<string, ObjectLease> = {};
    awareness.getStates().forEach((state: any, clientId: number) => {
      const lease = state?.lock as ObjectLease | undefined;
      if (!lease || lease.ownerClientId !== clientId || !isLeaseValid(lease, now)) return;
      const current = next[lease.objectId];
      if (!current || isEarlierLease(lease, current)) next[lease.objectId] = lease;
    });
    setLocks(next);
  }, []);

  useEffect(() => {
    if (!roomId) return;
    if (yDocRef.current.isDestroyed) yDocRef.current = new Y.Doc();

    const yDoc = yDocRef.current;
    const wsProvider = new WebsocketProvider(getWsUrl(), roomId, yDoc);
    providerRef.current = wsProvider;
    setProvider(wsProvider);
    setConnectionState('connecting');

    const statusHandler = (event: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      if (event.status === 'connected') setConnectionState('synced');
      else if (event.status === 'connecting') setConnectionState('connecting');
      else setConnectionState('reconnecting');
    };
    const syncHandler = (synced: boolean) => setConnectionState(synced ? 'synced' : 'connecting');
    const connectionErrorHandler = () => setConnectionState('offline');

    const awareness = wsProvider.awareness;
    awareness.setLocalStateField('user', { id: userId, name: userName });
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
      awareness.setLocalStateField('lock', null);
      wsProvider.off('status', statusHandler);
      wsProvider.off('sync', syncHandler);
      wsProvider.off('connection-error', connectionErrorHandler);
      awareness.off('update', awarenessHandler);
      wsProvider.disconnect();
      providerRef.current = null;
      setProvider(null);
      yDoc.destroy();
      setLocks({});
      setConnectionState('offline');
    };
  }, [roomId, rebuildLocks, setActiveUsers, setConnectionState, userId]);

  useEffect(() => {
    provider?.awareness.setLocalStateField('user', { id: userId, name: userName });
  }, [userId, userName, provider]);

  const getLocalLease = () => providerRef.current?.awareness.getLocalState()?.lock as ObjectLease | undefined;

  const claimLock = useCallback((objectId: string) => {
    const currentProvider = providerRef.current;
    if (!currentProvider) return false;
    const active = locks[objectId];
    if (active && active.ownerClientId !== currentProvider.awareness.clientID && isLeaseValid(active, Date.now())) return false;

    const existing = getLocalLease();
    const claimedAt = existing?.objectId === objectId ? existing.claimedAt : Date.now();
    const lease: ObjectLease = {
      objectId,
      ownerClientId: currentProvider.awareness.clientID,
      ownerUserId: userId,
      ownerName: userName || 'Collaborator',
      claimedAt,
      expiresAt: Date.now() + LEASE_DURATION_MS,
    };
    currentProvider.awareness.setLocalStateField('lock', lease);
    rebuildLocks();
    return true;
  }, [locks, rebuildLocks, userId, userName]);

  const refreshLock = useCallback((objectId: string) => {
    const lease = getLocalLease();
    if (!lease || lease.objectId !== objectId) return false;
    return claimLock(objectId);
  }, [claimLock]);

  const releaseLock = useCallback((objectId?: string) => {
    const currentProvider = providerRef.current;
    const lease = getLocalLease();
    if (!currentProvider || !lease || (objectId && lease.objectId !== objectId)) return;
    currentProvider.awareness.setLocalStateField('lock', null);
    rebuildLocks();
  }, [rebuildLocks]);

  const isLockOwnedByCurrentUser = useCallback((objectId: string) => {
    const currentProvider = providerRef.current;
    const lease = locks[objectId];
    return !!currentProvider && !!lease && lease.ownerClientId === currentProvider.awareness.clientID && isLeaseValid(lease, Date.now());
  }, [locks]);

  const collaboration = useMemo<CollaborationController>(() => ({
    locks,
    claimLock,
    refreshLock,
    releaseLock,
    isLockOwnedByCurrentUser,
  }), [locks, claimLock, refreshLock, releaseLock, isLockOwnedByCurrentUser]);

  return {
    yDoc: yDocRef.current,
    canvasObjectsMap: yDocRef.current.getMap<any>('canvas-objects'),
    provider,
    collaboration,
  };
};
