# Collaborative Whiteboard

A real-time collaborative whiteboard built with React, Fabric.js, Yjs, WebSockets, Express, and MongoDB.

The app is designed as a clean desktop and tablet workspace: a focused drawing canvas, a left tool rail, a responsive inspector, collaborative presence, theme-aware ink, local undo/redo, PNG export, and Mongo-backed room persistence.

## Features

- Real-time multi-user whiteboard rooms powered by Yjs and WebSockets.
- Persistent board state stored in MongoDB.
- Drawing, selection, rectangles, circles, text, and sticky notes.
- Sticky notes resize by reflowing text instead of scaling the font.
- Light and dark themes with default ink colors swapped for visibility.
- Local-only undo/redo history that avoids overwriting newer remote changes.
- Awareness-based soft locks while collaborators move, scale, rotate, or edit an object.
- PNG export with desktop download and iPad-friendly share/open fallback.
- Responsive tablet layout with a touch-friendly bottom-sheet inspector.

## Tech Stack

- Client: React, TypeScript, Vite, Fabric.js, Zustand, lucide-react
- Collaboration: Yjs, y-websocket awareness and shared maps
- Server: Node.js, Express, ws, y-websocket utilities
- Database: MongoDB, Mongoose

## Project Structure

```text
collaborative-whiteboard/
  client/                 React + Vite whiteboard app
  server/                 Express + WebSocket + Mongo persistence server
  package.json            Root scripts for installing, building, and dev
```

## Prerequisites

- Node.js 20 or newer
- npm
- MongoDB running locally on port `27017`

The default database URL is:

```text
mongodb://127.0.0.1:27017/collaborative-whiteboard
```

You can override it with `MONGO_URI` in `server/.env`.

## Install

From the project root:

```powershell
npm install
npm run install:all
```

## Run Locally

Start MongoDB first. If MongoDB is installed as a Windows service, make sure it is running. You can check the port with:

```powershell
Test-NetConnection 127.0.0.1 -Port 27017
```

Then start the app:

```powershell
npm run dev
```

That runs both:

- server: `http://localhost:5001`
- client: `http://localhost:5173`

If Vite says port `5173` is already in use, it will choose another port such as `5174`. Use the exact URL printed by Vite.

You can also run the services separately:

```powershell
npm run dev:server
npm run dev:client
```

## Open From an iPad

The PC is the host, so the iPad must use the PC's Wi-Fi IP address. Do not use `localhost` on the iPad, because that points to the iPad itself.

1. Connect the PC and iPad to the same Wi-Fi network.
2. Start MongoDB.
3. Start the server and client from the PC.
4. In the Vite output, copy the Network URL for the PC's Wi-Fi address.

Example:

```text
http://192.168.0.11:5174/?room=my-room
```

Open that URL in iPad Safari or Chrome.

If the page is blank or cannot connect:

- Confirm the Vite URL uses the PC Wi-Fi IP, not `localhost`.
- Confirm the backend is running on port `5001`.
- Allow Node.js through Windows Firewall for private networks.
- Make sure both devices are on the same Wi-Fi network, not guest/client-isolated Wi-Fi.
- Refresh the iPad page after restarting the server.

## Production Build

Build both client and server:

```powershell
npm run build
```

Start the compiled server:

```powershell
npm run start --prefix server
```

Preview the compiled client if needed:

```powershell
npm run preview --prefix client
```

## Useful Commands

```powershell
npm run build
npm run dev
npm run dev:client
npm run dev:server
npm run start --prefix server
```

To stop a running server in PowerShell, click that terminal and press `Ctrl+C`. If PowerShell asks whether to terminate the batch job, type `Y` and press Enter.

If a port is stuck, find the process:

```powershell
netstat -ano | findstr :5001
netstat -ano | findstr :5173
```

Then stop it by process ID:

```powershell
Stop-Process -Id <PID>
```

## Environment Variables

Server:

```text
PORT=5001
MONGO_URI=mongodb://127.0.0.1:27017/collaborative-whiteboard
```

Client:

```text
VITE_WS_URL=ws://localhost:5001
```

`VITE_WS_URL` is optional. Without it, the client automatically uses the current page hostname with backend port `5001`, switching between `ws:` and `wss:` based on the page protocol.

## Notes for Future Changes

- Keep Yjs-to-Fabric updates guarded so remote changes do not echo back as local edits.
- Keep Mongo persistence on the server through the debounced Yjs persistence adapter.
- Preserve sticky-note scaling by changing textbox width and resetting scale values.
- Route default ink color changes through the shared theme color mapping.
- Soft locks are transient awareness data and are not stored in MongoDB.

