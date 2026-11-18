# Whiteboard client

React, TypeScript, Fabric.js, Yjs, and Zustand implement the drawing workspace.
Start it from the project root with `npm run dev:client`, or start both services
with `npm run dev`.

See [the project README](../README.md) for setup, environment variables,
architecture, collaboration guarantees, and known limits.

From the root:

```powershell
npm run build
npm run test:client
npm run lint --prefix client
```

Client regression tests exercise a real headless Fabric canvas and React event
handlers. The test runner uses the server's existing TypeScript loader, so install
both packages before running tests. No browser or MongoDB is required.
