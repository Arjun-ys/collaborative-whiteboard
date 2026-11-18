# Collaborative Whiteboard

A real-time collaborative whiteboard built with React, Fabric.js, Yjs, WebSockets, Express, and MongoDB.

The app is designed as a clean desktop and tablet workspace: a focused drawing canvas, a left tool rail, a responsive inspector, collaborative presence, theme-aware ink, local undo/redo, PNG export, and Mongo-backed room persistence.

## Features

- Real-time multi-user whiteboard rooms powered by Yjs and WebSockets.
- Persistent board state stored in MongoDB.
- Drawing, selection, rectangles, circles, text, and sticky notes.
- Sticky notes resize by reflowing text instead of scaling the font.
- Personal light and dark themes with ink resolved locally without changing shared content.
- Local-only undo/redo history that avoids overwriting newer remote changes.
- Awareness-based soft locks while collaborators move, scale, rotate, or edit an object.
- Multi-object transforms saved as one shared transaction and one undo operation.
- PNG export with desktop download and iPad-friendly share/open fallback.
- Responsive tablet layout with a touch-friendly bottom-sheet inspector.
- Pan tool, Space-drag navigation, wheel panning, pointer-centered zoom, and fit-to-content.
- Named collaborator cursors, selection outlines, and editing indicators.

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

- Node.js 22.12 or newer (Node 20.19 also meets the current toolchain requirements)
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

The server serves the compiled client and WebSockets together at
`http://localhost:5001`. You can also use `npm start` from the root. See
[DEPLOYMENT.md](DEPLOYMENT.md) for Docker, production origins, and reverse proxy setup.

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
npm test
npm run lint --prefix client
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

`VITE_WS_URL` is optional. Development uses the current page hostname with backend
port `5001`. Production builds use the page's own host and port, switching between
`ws:` and `wss:` based on its protocol. For a separately hosted frontend or Vite
production preview, set `VITE_WS_URL` to the backend before building.

## Notes for Future Changes

- Keep Yjs-to-Fabric updates guarded so remote changes do not echo back as local edits.
- Keep Mongo persistence on the server through the room persistence coordinator.
- Preserve sticky-note scaling by changing textbox width and resetting scale values.
- Route default ink color changes through the shared theme color mapping.
- Soft locks are transient awareness data and are not stored in MongoDB.

## Architecture and Collaboration Guarantees

Fabric is the local canvas view. A Yjs map stores serialized objects keyed by ID;
WebSockets replicate that document to other participants. Awareness carries names,
cursors, selections, and advisory object leases. MongoDB stores binary document snapshots.

The server completes room hydration before processing collaboration messages.
Writes are serialized per room, debounced by 2.5 seconds, and scheduled at least
every 10 seconds during continuous editing when storage is available. Failed
writes retain the in-memory document and retry. Rejoining during a final save
uses that same document. Controlled shutdown flushes pending changes.

Theme-dependent ink uses a canonical storage color and is resolved for each
client's theme. Group transforms persist their members in world coordinates.
Undo checks every affected object's expected shared snapshot before committing
and skips an operation if a collaborator has changed or locked an object.
Remote changes received during a local interaction are reconciled at completion;
remote deletion ends the affected interaction without resurrecting the object.

These guarantees have deliberate limits:

- Rooms are anonymous: anyone with the link can edit. There is no ownership or read-only sharing.
- A plain serialized object is one Yjs map value; concurrent edits to different properties of the same object do not merge independently.
- Leases guide interaction and are not server-enforced exclusive locks.
- "Synced" means document synchronization, not acknowledgment that MongoDB has saved the edit.
- Abrupt process termination can lose edits since the last successful snapshot. Retry state is held in memory.
- The persistence coordinator is for one server instance. Multiple instances need coordinated room routing and storage.
- PNG export covers all content with padding, independently of the current viewport. Export resolution is capped to 16 million pixels and 8192 pixels per edge.

For production, the default is one Express server serving the client and WebSockets
behind a TLS reverse proxy. Separately hosted clients need `VITE_WS_URL` and an
explicit `ALLOWED_ORIGINS` entry. Define the room access policy before publishing.
Room names support letters, numbers,
hyphens, and underscores, up to 128 characters; `health` is reserved.

## Verification

From the root after installing dependencies:

```powershell
npm run build
npm test
npm run lint --prefix client
```

The regression suite uses Node's test runner, headless React/Fabric canvases,
two real WebSocket clients, and an injected storage adapter. It covers local
themes, grouped transforms and history, sticky sizing, remote edits/deletes
during interaction, inspector edits, clear-dialog keyboard behavior, hydration
failure, retry, save ordering, maximum save delay, and immediate rejoin. Navigation,
full-content export, presence overlays, object validation, production asset serving,
and origin policy are also covered.
It does not require MongoDB and does not modify real boards.

## Canvas Navigation

- Choose **Pan (H)** or hold **Space** and drag. Middle-button dragging also pans.
- Scroll to pan; hold Ctrl/Cmd while scrolling to zoom around the pointer.
- Use the bottom canvas controls to zoom, fit all content, or reset the view.
- Viewport changes are personal and are never stored in the shared document.
- Collaborator cursors are throttled and expire after inactivity; selection and
  editing outlines follow your local viewport.

The document renderer accepts the vector and text types used by these tools.
External images, patterns, gradients, SVG imports, and rich text styles are outside
the supported document format.

## Dependency Status

The October 6 update moves the build to Vite 6 and Tailwind 4, updates compatible
server dependencies, and uses Canvas 3 for Fabric's Node rendering dependency.
The server audit is clean. The client audit has one remaining high-severity Fabric
advisory; a Fabric major-version migration is still needed. Input validation
restricts rendering to supported vector/text objects, but it is not a replacement
for resolving the dependency advisory.

GitHub Actions now runs builds, regression tests, lint, server high-severity audit,
and client critical-severity audit on Node 22. The workflow has been added locally;
its hosted run will happen after pushing the repository.

Fabric's Node canvas dependency requires native libraries when a prebuilt binary
is unavailable. On Ubuntu, install `libcairo2-dev`, `libpango1.0-dev`,
`libjpeg-dev`, and `libgif-dev` before installing dependencies.

The initial audit and remaining product work are in [PROJECT_REVIEW.md](PROJECT_REVIEW.md).

For a detailed explanation of the architecture, code flow, collaboration logic,
persistence, tradeoffs, and interview preparation, read [PROJECT_GUIDE.md](PROJECT_GUIDE.md).
