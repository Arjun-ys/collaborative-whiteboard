# Run the production build

Install the root, client, and server dependencies, then from the root:

```powershell
npm run build
$env:NODE_ENV = 'production'
npm start
```

Open `http://localhost:5001/?room=demo`. Express serves the client assets and
handles the WebSocket upgrade on the same port. MongoDB must be reachable through
`MONGO_URI`; copy `server/.env.example` to `server/.env` for local settings.

Use Node 22.12 or newer. The current local Node 20.13 installation is below the
React build plugin and lint engine requirements, even though local checks have
run successfully. The container and CI use Node 22.

# Docker Compose

Start Docker Desktop's Linux engine first, then:

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose logs -f app
```

The app listens on `127.0.0.1:5001`; MongoDB stays on the Compose network and stores
boards in the `board-data` named volume. `docker compose down` stops the services
while retaining that volume. Do not add `--volumes` if you want to retain boards.
Compose gives the app 45 seconds to finish its shutdown flush.

The Compose configuration has been validated. A container build/run has not been
verified locally because the Docker engine was not running.

# Public hosting

Run one application instance behind an HTTPS proxy that preserves the incoming
Host header and supports WebSocket upgrades. The production client automatically
connects to `wss://` on that same host, so no client environment override is needed.

For example, the following Nginx directives belong in the HTTPS site's location
block, with the application's local port as the upstream:

```nginx
location / {
    proxy_pass http://127.0.0.1:5001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 75s;
}
```

For a separately hosted client, set `VITE_WS_URL=wss://backend.example.com` before
building it and `ALLOWED_ORIGINS=https://frontend.example.com` on the server.
Multiple origins are comma-separated. Production accepts same-host browser
origins plus that explicit list. Development also permits another port on the
same hostname for Vite/LAN use. Native clients without an Origin header can still
connect; origin checking is not authentication.

The server limits concurrent sockets to 128 and individual WebSocket messages to
2 MiB. Rooms remain anonymous and editable by anyone with their link. Stronger
room authorization, rate limits, total board-size quotas, and multi-instance
coordination are separate work. Snapshots are debounced; abrupt termination can
lose edits since the last successful save.

Before public release, finish the remaining Fabric dependency migration and
verify browser/tablet interaction and MongoDB failure/restart behavior. No public
deployment, hosting account changes, or repository push was performed in this pass.
