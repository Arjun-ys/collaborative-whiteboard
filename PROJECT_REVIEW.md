# Collaborative Whiteboard assessment

October 6 update: added pan/zoom, fit/reset, full-content PNG export, named cursors,
selection/editing overlays, vector/text input validation, same-port production
serving, browser-origin policy, Docker/Compose configuration, and a CI workflow.
Compatible server dependencies now audit clean. Vite 6, Tailwind 4, and Canvas 3
reduce the client audit to one remaining high-severity Fabric advisory. The older
audit totals below are historical. Docker configuration is validated; container
execution and the hosted CI run are not yet verified. See DEPLOYMENT.md.

Current priorities before presenting a public demo:

1. Migrate Fabric to a patched major version and repeat the interaction checks.
2. Verify two real browsers/tablets and MongoDB interruption/restart end to end.
3. Decide whether rooms remain anonymous; add room authorization and resource
   limits before claiming private or production-grade collaboration.
4. Extract history, object synchronization, and interaction handling from the
   large Whiteboard component. Navigation, snapshots, presence validation, and
   persistence already have separate modules, but canvas orchestration remains dense.
5. Publish a working demo, add actual screenshots or a short recording, and explain
   the concurrency and durability tradeoffs in the portfolio presentation.

Local verification on October 6: 34 tests pass (24 client and 10 server), with
strict production builds and lint passing. Public deployment and hosted CI remain
unverified. The assessment sections below describe the original October 4 state.

Implementation update, October 5, 2026: the first reliability pass addresses
local theme rendering, grouped transforms, sticky completion, hydration gating,
serialized/retried saves and immediate rejoin, remote interaction reconciliation,
provider cleanup, history replay, selection-aware inspector values, and clear-dialog
keyboard behavior. Regression tests and verification commands are now included.
The assessment below records the original findings; it is not a fresh list of
unresolved defects. The October 6 pass adds navigation, collaborator visualization,
supported-object validation, and deployment configuration. Room authorization,
broader module extraction, and verification of a public deployment remain next steps.

Validation for this implementation: strict client/server builds, lint, and the
regression suite pass. Tests use a real headless Fabric canvas and real two-client
WebSocket traffic with mocked storage; browser/tablet rendering and actual MongoDB
failure/restart behavior still need end-to-end verification.

The October 5 client lockfile audit reports 16 dependency findings (13 high,
2 moderate, 1 critical). The critical finding is in `tar`, through Fabric's Node
canvas installation dependency chain. Vite/build tooling also needs updates.
This calls for a separate tested dependency migration; audit severity alone does
not establish that the application's browser bundle exposes an exploitable path.

Reviewed on October 4, 2026. Scope: application source, installed library behavior, architecture, interaction design, persistence, build and project presentation. No application source was changed.

## Overall judgment

This is a worthwhile resume project with more substance than a basic CRUD application. Real-time collaboration, canvas serialization, awareness leases, and conflict-aware local history give you useful engineering decisions to explain in interviews. The stack is appropriate. The main weakness is reliability at the boundaries between Fabric, Yjs, React, and MongoDB.

I would describe the current version as a promising collaborative prototype. Before presenting it as a dependable deployed application, fix the correctness issues below, add focused integration tests, and make the demo easy to run and understand. More tools and visual effects are a lower priority.

## Architecture

The current flow is:

```text
React controls / Zustand tool settings
                |
          Fabric canvas
                |
    Y.Map<object ID, serialized object>
                |
      y-websocket room server
                |
    MongoDB binary Yjs snapshots

Awareness carries display names and transient object leases.
Local snapshot stacks implement undo and redo.
```

Good decisions:

- Fabric handles drawing and selection instead of reimplementing a canvas editor.
- Yjs handles replicated document convergence and reconnect synchronization.
- Awareness is appropriate for transient presence and advisory locks.
- An object index avoids repeatedly searching the canvas by ID.
- Shared custom serialization properties reduce round-trip mistakes.
- Undo checks the shared object's current snapshot before overwriting it.
- The server stays small; Express, ws, and MongoDB are sufficient for a single-instance demo.

Limits to understand:

- Each object is one plain serialized value in a Y.Map. Concurrent edits to different properties of the same object compete as whole-object replacements. Yjs convergence does not provide property-level merging or collaborative text editing with this model.
- Changes are generally broadcast at commit time, rather than throughout a drag or each text edit. Presence currently means participant count and lock state; there are no remote cursors or selection outlines.
- Object order is implicit in local canvas insertion. There is no explicit shared ordering model to guarantee identical overlap order after concurrent additions and reloads.
- MongoDB stores snapshots; it does not coordinate multiple WebSocket server instances. Horizontal scaling requires shared room routing or a replication layer and coordinated persistence.
- `Whiteboard.tsx` contains 760 lines spanning rendering, synchronization, locks, history, input, export, theme conversion, and sticky behavior. Splitting by these responsibilities would make correctness easier to reason about without changing the stack.

Recommended boundary: shared document data is authoritative; Fabric is its local view; tools submit explicit edit commands; awareness supplies advisory interaction state; MongoDB provides durability. Put validation and shared transactions behind a typed document adapter.

## Prioritized correctness findings

### 1. High: personal theme changes modify shared content

Evidence: `client/src/components/Whiteboard.tsx:710–735`.

The theme effect recolors existing objects and writes each result into the shared map. If Alice uses light mode and Bob uses dark mode, Alice's toggle can turn Bob's light ink dark while his canvas stays black. Receiving remote objects does not remap their colors to the receiving user's theme. Theme writes also bypass the normal lock and history paths, and change snapshots used by undo conflict checks.

Fix: persist a semantic ink token or a stable canonical color, resolve it for each client's view, and convert back to canonical data on serialization. Keep explicit user-selected colors distinct from theme-dependent ink. Test two clients using different themes.

### 2. High: multi-object transforms have no member persistence path

Evidence: `Whiteboard.tsx:179–193`, `275–285`, `462–474`; installed Fabric's transform finalization targets the `ActiveSelection` wrapper.

Fabric enables multi-selection, but that wrapper has no application object ID. Lock acquisition and modification persistence return early for targets without an ID. Moving or scaling a selection therefore does not commit its member objects through the normal synchronization/history path. Member coordinates also need conversion out of group-relative space before persistence.

Fix: handle selection members explicitly, validate member locks, serialize world-space transforms, and commit all members in one Yjs transaction and one history command. Alternatively disable multi-object transformations until supported.

### 3. High: sticky resize handler listens for an absent event

Evidence: `Whiteboard.tsx:504–517`; installed Fabric emits `scaling` during a transform and `modified` on completion, with no `object:scaled` emitter in its source.

The width/reflow normalization callback will not run on normal scaling. Sticky notes retain scale values, visually scaling their text instead of keeping a fixed font size as the README promises.

Fix: normalize sticky dimensions within the actual transform-completion path before serialization, then persist once. Verify corner and side handles and confirm that remote clients receive the normalized dimensions.

### 4. High: failed hydration can overwrite persisted content

Evidence: `server/src/services/db.ts:23–38`, `70–97`; installed y-websocket does not await `bindState` before accepting sync traffic.

A database read failure is logged and treated as a usable room. Later saves can replace the previous board snapshot with a partial or empty document. `writeState` also catches write errors and resolves, allowing the library to destroy the document despite a failed final save.

Verification: an isolated check mocked a failed read and confirmed that `writeState` subsequently wrote an empty Yjs snapshot. No actual database calls were made.

Fix: make loading failure explicit, gate room editing/saving on successful hydration, and retain recoverable state when a final save fails. Propagate failures into a deliberate retry/recovery lifecycle rather than swallowing them.

### 5. High: hydration, save ordering, and reconnect races

Evidence: `db.ts:40–67`, `70–97`; installed y-websocket removes the room from its in-memory registry before the final write finishes.

- The update listener is attached after hydration. An edit received during the database read triggers no debounced save. An isolated mocked check confirmed zero writes after such an edit and a 2.7-second wait. A later edit or successful final disconnect save can still persist it.
- Saves replace the full snapshot with no per-room serialization. An older write completing after a newer one can leave stale stored state.
- Immediate rejoin can load a new room while the previous room's final save is still pending.
- Continuous edits can indefinitely postpone the trailing debounce. There is no maximum save interval or graceful shutdown flush.

Fix: coordinate load and close per room, serialize writes, keep a dirty generation counter, impose a maximum save delay, and flush on controlled shutdown. For stronger durability, consider an append-only update store plus periodic compacted snapshots.

### 6. Medium: locks do not make conflicting edits safe

Evidence: `client/src/hooks/useYjs.ts:102–127`; `Whiteboard.tsx:209–214`, `251–255`, `275–285`, `476–502`.

Claims return success immediately, before concurrent claims have converged. Leases use client wall clocks and expire after 15 seconds. Text editing does not periodically renew its lease. Worse, incoming updates and deletes are discarded while the local interaction owns a lease rather than retained for later reconciliation. A peer clearing an actively edited object can leave a stale local canvas object, and a later local commit can resurrect it.

Fix: keep leases advisory, always retain the latest remote state, reconcile against the shared map at interaction completion, renew throughout text editing, and specify what clear/delete wins over. If exclusivity is a requirement, client awareness alone cannot enforce it.

### 7. Medium: connection lifecycle and status need tightening

Evidence: `useYjs.ts:24`, `57–62`, `78–90`.

`useRef(new Y.Doc())` constructs a discarded document on every render. Cleanup calls provider `disconnect()` instead of `destroy()`; the installed provider's destroy method also clears its periodic check and unregisters listeners. React StrictMode and room changes deserve lifecycle tests. A connected socket is labeled `synced` before initial document sync necessarily completes.

Fix: create the document lazily for a room, destroy its provider on cleanup, and keep transport connection, document synchronization, and database durability as separate states.

### 8. Medium: undo has useful guards but incomplete guarantees

Evidence: `Whiteboard.tsx:348–433`.

Comparing expected snapshots is a good safeguard. However, skipped entries still move between undo/redo stacks; asynchronous restoration has no final shared-map conflict check; replay is not blocked while another replay is pending; and locks are not consistently honored by restoration/deletion paths. Theme changes can invalidate history without a content edit by another collaborator.

Fix: use explicit command outcomes, serialize history replay, recheck before asynchronous commits, and batch clear/group operations. Test local undo after remote edit/delete and redo after a skipped undo. Evaluate Y.UndoManager only after defining transaction origins and desired collaborative undo semantics.

## Product and interface design

This part is source-based: browser automation was unavailable, so visual rendering, actual device behavior, and browser interactions were not verified.

The header, left tool rail, central canvas, and inspector form a coherent workspace. CSS theme tokens, focus styles, reduced-motion handling, safe-area spacing, and 44px tablet tool targets show thoughtful design work.

The interaction model needs refinement:

- Inspector controls show global tool defaults instead of selected-object values. Selecting an existing text object does not expose its font controls because the selected text type is not represented in the store.
- Sticky creation hardcodes font size 16 despite the inspector exposing a font-size control for the sticky tool.
- Clicking a selected object claims a lock, while the inspector property effect refuses changes whenever any lease exists, including the local user's own lease.
- The inspector starts open. On touch layouts it becomes a high-z-index bottom sheet over the bottom tool rail, requiring dismissal before accessing covered tools.
- Small-screen CSS hides undo/redo and theme controls without replacement controls.
- There is no pan/zoom model. Objects outside a smaller viewport become inaccessible, and PNG export uses current viewport dimensions rather than a stable board extent or content bounds.
- Locks have no visible owner outline or badge, despite owner names being available. Participant count alone offers little collaborative context.
- The clear dialog lacks dialog semantics, focus management, Escape handling, and keyboard trapping. Toasts lack a live announcement region. Icon-only Share/Export controls need accessible labels when their text is hidden.
- Repeated clear requests can replace the confirmation resolver and leave an earlier Promise unresolved.

Recommended design work: separate tool defaults from selection properties; add explicit selected-object state; make the tablet inspector collapsed initially; retain essential actions in a compact menu; add pan/zoom and fit-to-content; and show remote cursor/selection/lock ownership. These improvements make the existing capabilities feel complete.

## Server, deployment, and maintainability

- Rooms are anonymous and public to anyone who knows the URL. This is acceptable as an explicit demo policy, but there is no board ownership or read-only sharing.
- WebSocket upgrades accept every path except `/health`, with no origin allowlist, authentication, room validation, room quota, or application-specific payload limits. Express CORS does not restrict WebSocket connections.
- Untrusted clients can write arbitrary shared object data. Validate supported object types, IDs, dimensions, text lengths, and resource references before rendering; design server enforcement if exposing the service publicly.
- The full Mongo URI is logged and can expose credentials when a hosted database URI is used.
- Health reports process activity, not current database readiness. Clients have no durable-save acknowledgment.
- The client backend fallback hardcodes port 5001. Production needs an explicit WSS URL or same-origin proxy configuration. The compiled server serves no client assets.
- Client TypeScript does not enable strict mode, and important boundaries use `any`. Introduce typed serialized objects, validated awareness messages, and typed Y.Map adapters.
- `Toolbar`, `PropertiesPanel`, `UserIdentity`, and `ConnectionStatus` are superseded by the current UI and appear unused. Remove these and unused starter assets after checking references.
- There are no repository tests or CI workflow in the inspected tree. The README has good local instructions but needs `.env.example` files, a reproducible demo setup, architecture/tradeoff notes, screenshots, and deployment instructions.

## Validation completed

- Client and server production builds passed.
- Vite reported a 635.66 kB JavaScript bundle, 192.21 kB gzip. This is an optimization opportunity, not the main blocker.
- Lint failed to start because the installed `@oxlint/binding-win32-x64-msvc` dependency is missing. This is an environment/install issue, not a demonstrated source lint failure.
- Isolated mocked persistence checks confirmed the early-edit save gap and save-after-hydration-failure behavior.
- Installed Fabric and y-websocket source was inspected to verify event and lifecycle behavior.
- MongoDB's local port was reachable. Real database persistence, multi-browser end-to-end behavior, export, and tablet rendering were not exercised.

## Recommended completion order

1. Correct theme isolation, multi-selection persistence, sticky resizing, remote delete reconciliation, and provider cleanup.
2. Coordinate hydration and durable saves, including retries, ordering, immediate reconnect, and shutdown.
3. Add targeted two-client tests: create/edit/delete, different themes, grouped movement, text lease expiry, clear during editing, reconnect, undo after remote changes, and restart persistence. Test failure paths with a mocked database.
4. Finish selection-aware inspector behavior, pan/zoom, visible collaborators, and keyboard/tablet access.
5. Prepare a public demo with a documented room access policy, bounded resource usage, WSS configuration, CI, screenshots, and a short architecture explanation.

For a resume, the strongest story is reliable synchronization under concurrency and failure. Be prepared to explain what Yjs guarantees, what your whole-object data model does not guarantee, why awareness locks are advisory, and how a synchronized edit becomes durable. Report user counts, latency, or load capacity only after measuring them.
