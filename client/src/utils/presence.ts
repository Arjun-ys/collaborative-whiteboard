import type { Collaborator } from '../types/collaboration';
const colors = ['#60a5fa', '#a78bfa', '#34d399', '#fb7185', '#fbbf24', '#f472b6'];
export const collaboratorColor = (clientId: number) => colors[Math.abs(clientId) % colors.length];

export const readCollaborators = (states: Map<number, Record<string, any>>, localId: number, now = Date.now()): Collaborator[] => {
  const peers: Collaborator[] = [];
  states.forEach((state, clientId) => {
    if (clientId === localId || !state.user || typeof state.user.name !== 'string') return;
    const presence = state.presence;
    const cursor = presence?.cursor;
    const validCursor = cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y) &&
      Math.abs(cursor.x) <= 1_000_000 && Math.abs(cursor.y) <= 1_000_000 &&
      Number.isFinite(cursor.updatedAt) && now - cursor.updatedAt <= 15_000 && cursor.updatedAt <= now + 15_000;
    peers.push({ clientId, name: state.user.name.slice(0, 40) || 'Collaborator', color: collaboratorColor(clientId),
      cursor: validCursor ? { x: cursor.x, y: cursor.y } : null,
      selectedIds: Array.isArray(presence?.selectedIds)
        ? presence.selectedIds.filter((id: unknown): id is string => typeof id === 'string' && id.length <= 128).slice(0, 100) : [],
    });
  });
  return peers;
};
