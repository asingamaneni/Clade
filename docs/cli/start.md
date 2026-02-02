# clade start

Start the Clade gateway server.

## Usage

```bash
clade start [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <port>` | Override gateway port | `7890` (from config) |
| `--host <host>` | Override bind address | `127.0.0.1` (from config) |
| `-v, --verbose` | Enable verbose logging | `false` |

## What It Starts

- **HTTP/WebSocket server** on the configured port
- **Channel adapters** (Slack, Telegram, Discord) if enabled
- **Heartbeat scheduler** for all agents with heartbeat enabled
- **Admin dashboard** at `http://localhost:7890/admin`
- **REST API** at `http://localhost:7890/api/*`

## Examples

```bash
# Start with defaults
clade start

# Start on a custom port
clade start --port 8080

# Start with verbose logging
clade start --verbose
```

## Signals

- `Ctrl+C` (SIGINT) — Graceful shutdown (disconnects channels, stops scheduler)
- `SIGTERM` — Same as SIGINT
