export type ConnectionState = 'connecting' | 'synced' | 'reconnecting' | 'offline';

export interface ObjectLease {
  objectId: string;
  ownerClientId: number;
  ownerUserId: string;
  ownerName: string;
  claimedAt: number;
  expiresAt: number;
}

export interface CollaborationController {
  locks: Record<string, ObjectLease>;
  claimLock: (objectId: string) => boolean;
  refreshLock: (objectId: string) => boolean;
  releaseLock: (objectId?: string) => void;
  isLockOwnedByCurrentUser: (objectId: string) => boolean;
}
