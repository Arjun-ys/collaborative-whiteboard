export type ConnectionState = 'connecting' | 'synced' | 'reconnecting' | 'offline';

export interface Collaborator {
  clientId: number;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selectedIds: string[];
}

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
  claimLocks: (objectIds: string[]) => boolean;
  refreshLock: (objectId: string) => boolean;
  releaseLock: (objectId?: string) => void;
  isLockOwnedByCurrentUser: (objectId: string) => boolean;
  peers?: Collaborator[];
  publishCursor?: (cursor: { x: number; y: number } | null) => void;
  publishSelection?: (objectIds: string[]) => void;
}
