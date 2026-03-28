# NLPL on Nexus Hosting

[NLPL](https://github.com/Zajfan/NLPL) is a programming language designed for clarity and simplicity. Nexus Hosting supports NLPL as a first-class runtime alongside static sites.

## How it works

NLPL sites run as **persistent server processes**. When you start your site:

1. Your uploaded `.nlpl` files are extracted to a temporary work directory on the node
2. The NLPL interpreter (`python3 /opt/nlpl/src/main.py server.nlpl`) is launched
3. Your server receives a `PORT` environment variable and must listen on it
4. The node's reverse proxy forwards all requests for your domain to that port
5. If the process crashes, it is automatically restarted (up to 5 times with exponential backoff)

## Deploying an NLPL site

1. **Register your site** — go to My Sites → New Site → choose type **NLPL**
2. **Upload your files** — drag and drop your `.nlpl` files (and any assets)
3. **Deploy** — click Deploy to commit the files
4. **Start the process** — the NLPL panel will appear; click **Start Process**

Your site is now live at your domain.

## Required: entry file

Your deployment must contain a file named `server.nlpl` (or whatever you set as the entry file in the panel). This is the file the interpreter runs.

Your server **must** listen on the `PORT` environment variable:

```nlpl
call network.serve_http with handle_request, PORT
```

## Examples

### Hello World (`hello-world/server.nlpl`)

The minimal NLPL web server — one function, one route, live in seconds.

### Router (`router/server.nlpl`)

Multi-route server demonstrating path-based request routing and JSON responses.

## Environment variables available to your NLPL app

| Variable | Value |
|---|---|
| `PORT` | The port your server must listen on (allocated by the node) |
| `NODE_ENV` | `production` |
| `SITE_DOMAIN` | Your site's domain (e.g. `mysite.example.com`) |
| `NLPL_ENV` | `production` |

**Note:** Database URLs, Redis URLs, API keys, and all node credentials are intentionally not passed to site processes for security.

## Node operator setup

To enable NLPL hosting on your node:

```bash
# Install the NLPL interpreter
git clone https://github.com/Zajfan/NLPL /opt/nlpl

# Verify Python 3 is available
python3 --version

# Set in your .env
NLPL_INTERPRETER_PATH=/opt/nlpl/src/main.py
PYTHON_BIN=python3
DYNAMIC_PORT_START=9000
DYNAMIC_PORT_END=9999
```

Then restart the node. NLPL hosting is now available to all users.

## Current limitations

- NLPL is an interpreted language (via Python) — not compiled yet. Performance is proportional to Python's.
- Each site gets one process — no horizontal scaling per site yet.
- Processes are not containerised — they run as the same user as the API server. Set `DYNAMIC_PROCESS_USER` for additional isolation (requires running as root initially).
- Persistent writable storage is the work directory (`/tmp/nlpl-site-<id>`) — it is cleared on redeploy.

These limitations will improve as NLPL matures toward its 1.0 compiled release.
