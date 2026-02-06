# API Endpoints

The Clade gateway exposes a REST API on the configured port (default `7890`).

## Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents |
| `POST` | `/api/agents` | Create an agent |
| `GET` | `/api/agents/:id` | Get agent details |
| `PUT` | `/api/agents/:id` | Update agent config |
| `DELETE` | `/api/agents/:id` | Remove an agent |
| `GET` | `/api/agents/:id/memory` | Browse agent memory |
| `POST` | `/api/agents/:id/memory/search` | Search agent memory |

## Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/:id` | Get session details |
| `POST` | `/api/sessions/:id/send` | Send message to session |
| `DELETE` | `/api/sessions/:id` | Terminate session |

## MCP Servers

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/mcp` | List MCP servers (active + pending) |
| `POST` | `/api/mcp/:name/approve` | Approve a pending MCP server |
| `DELETE` | `/api/mcp/:name` | Remove an MCP server |

## Cron

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/cron` | List cron jobs |
| `POST` | `/api/cron` | Create a cron job |
| `DELETE` | `/api/cron/:id` | Delete a cron job |

## Config

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | Get global config |
| `PUT` | `/api/config` | Update global config |

## Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/webhook/:agentId` | Trigger an agent via webhook |

## WebSocket

| Path | Description |
|------|-------------|
| `/ws` | WebChat real-time connection |
| `/ws/admin` | Admin dashboard real-time updates |

## Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (returns `{ status: "ok" }`) |

## Admin UI

| Path | Description |
|------|-------------|
| `/admin` | Admin dashboard (Preact + HTM + Tailwind) |
| `/` | Redirects to `/admin` |
