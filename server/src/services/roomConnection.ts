import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';
import type { RoomPersistence } from './roomPersistence';

export const connectRoom = async (
  ws: WebSocket,
  request: IncomingMessage,
  persistence: RoomPersistence,
  isShuttingDown: () => boolean = () => false,
  onError: (error: unknown) => void = console.error,
) => {
  const name = new URL(request.url!, 'http://localhost').pathname.slice(1);
  ws.on('error', onError);
  ws.pause();
  let handle: Awaited<ReturnType<RoomPersistence['acquire']>> | undefined;
  try {
    handle = await persistence.acquire(name);
    if (ws.readyState !== ws.OPEN || isShuttingDown()) {
      await handle.release();
      ws.close(1012, 'Server restarting');
      ws.resume();
      return;
    }
    setupWSConnection(ws, request, { docName: name });
    ws.once('close', () => void handle!.release());
    ws.resume();
  } catch (error) {
    if (handle) await handle.release();
    onError(error);
    ws.close(1013, 'Room unavailable; retry later');
    ws.resume();
  }
};
