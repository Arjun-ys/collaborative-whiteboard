import type { ObjectLease } from '../types/collaboration';

export const resolveLeases = (states: Map<number, Record<string, unknown>>, now = Date.now()) => {
  const locks: Record<string, ObjectLease> = {};
  states.forEach((state, clientId) => {
    const candidates = Array.isArray(state.locks) ? state.locks : [state.lock];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      const lease = candidate as ObjectLease;
      if (typeof lease.objectId !== 'string' || typeof lease.ownerName !== 'string' ||
          typeof lease.ownerUserId !== 'string' || lease.ownerClientId !== clientId ||
          !Number.isFinite(lease.claimedAt) || !Number.isFinite(lease.expiresAt) || lease.expiresAt <= now) continue;
      const current = locks[lease.objectId];
      if (!current || lease.claimedAt < current.claimedAt ||
          (lease.claimedAt === current.claimedAt && clientId < current.ownerClientId)) locks[lease.objectId] = lease;
    }
  });
  return locks;
};
