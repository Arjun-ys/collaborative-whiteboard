import express from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';

export const createApp = (options: {
  clientDirectory: string;
  isDatabaseReady: () => boolean;
  pendingRooms: () => number;
  allowedOrigins: string[];
}) => {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: options.allowedOrigins.length ? options.allowedOrigins : false }));
  app.get('/health', (_request, response) => {
    const ready = options.isDatabaseReady();
    response.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable', pendingRooms: options.pendingRooms() });
  });
  if (existsSync(path.join(options.clientDirectory, 'index.html'))) {
    app.use('/assets', express.static(path.join(options.clientDirectory, 'assets'), { immutable: true, maxAge: '1y', dotfiles: 'deny' }));
    app.use(express.static(options.clientDirectory, { maxAge: 0, dotfiles: 'deny' }));
  }
  return app;
};
