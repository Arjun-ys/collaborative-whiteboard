import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';
import { connectDB, mongodbPersistence } from './services/db';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Basic Server Health Check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Whiteboard Server is active', time: new Date() });
});

// Create standard HTTP server wrapping Express
const server = http.createServer(app);

// Create WebSocket server matching y-websocket expectations
const wss = new WebSocketServer({ noServer: true });

// Bind the MongoDB Persistence adapter to y-websocket
setPersistence(mongodbPersistence);

wss.on('connection', (ws, req) => {
  console.log(`[WS] New connection requested from URL: ${req.url}`);
  setupWSConnection(ws, req);
});

// Intercept Upgrade requests and route them to WebSocket server safely
server.on('upgrade', (request, socket, head) => {
  let pathname = '/';
  try {
    pathname = request.url ? new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname : '/';
  } catch (e) {
    console.error('[Server] Upgrade URL parsing error:', e);
  }
  
  if (pathname !== '/health') {
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
});
