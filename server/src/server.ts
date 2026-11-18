import http from 'http';
import path from 'path';
import { WebSocketServer } from 'ws';
import { setPersistence, getYDoc, docs } from 'y-websocket/bin/utils';
import { connectDB, boardStorage } from './services/db';
import { RoomPersistence } from './services/roomPersistence';
import { connectRoom } from './services/roomConnection';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createApp } from './app';
import { allowedOriginsFromEnv, permittedWsOrigin, validRoomPath } from './services/connectionPolicy';

dotenv.config();

const port = process.env.PORT || 5001;
const allowedOrigins = allowedOriginsFromEnv(process.env.ALLOWED_ORIGINS);
const app = createApp({
  clientDirectory: path.resolve(__dirname, '../../client/dist'),
  isDatabaseReady: () => mongoose.connection.readyState === 1,
  pendingRooms: () => persistence.pendingRooms,
  allowedOrigins,
});

// Create standard HTTP server wrapping Express
const server = http.createServer(app);

// Create WebSocket server matching y-websocket expectations
const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

// Own hydration and collection: the library adapter does not await loading.
setPersistence(null);
const persistence = new RoomPersistence(boardStorage, {
  createDoc: (name) => getYDoc(name),
  disposeDoc: (name, doc) => { if (docs.get(name) === doc) docs.delete(name); },
  onError: (error, name) => console.error(`[DB] Save failed for room ${name}; retaining state for retry.`, error),
});
let shuttingDown = false;

wss.on('connection', (ws, req) => {
  void connectRoom(ws, req, persistence, () => shuttingDown,
    (error) => console.error('[WS] Room connection failed:', error));
});

// Intercept Upgrade requests and route them to WebSocket server safely
server.on('upgrade', (request, socket, head) => {
  let pathname = '/';
  try {
    pathname = request.url ? new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname : '/';
  } catch (e) {
    console.error('[Server] Upgrade URL parsing error:', e);
  }
  
  if (!shuttingDown && wss.clients.size < 128 && validRoomPath(pathname) && permittedWsOrigin(request, allowedOrigins, process.env.NODE_ENV !== 'production')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Run server
const start = async () => {
  await connectDB();
  server.listen(port, () => {
    console.log(`[Server] Running at http://localhost:${port}`);
    console.log(`[Server] WebSockets listening on ws://localhost:${port}`);
  });
};

start().catch((err) => {
  console.error('[Server] Startup error:', err);
  process.exitCode = 1;
});

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  for (const ws of wss.clients) ws.terminate();
  try {
    await persistence.flushAll();
    await mongoose.disconnect();
    for (const doc of docs.values()) doc.destroy();
    docs.clear();
    console.log('[Server] Pending board state flushed.');
  } catch (error) {
    console.error('[Server] Shutdown flush failed; retaining process for retry.', error);
    setTimeout(() => { shuttingDown = false; void shutdown(); }, 2500);
  }
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
