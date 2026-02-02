# Configuration Reference

Clade configuration lives at `~/.clade/config.json`. Override the location with the `CLADE_HOME` environment variable.

## Full Schema

```json
{
  "version": 2,

  "agents": {
    "<agent-id>": {
      "name": "Display Name",
      "description": "What this agent does",
      "model": "sonnet",
      "toolPreset": "full",
      "customTools": [],
      "skills": [],
      "heartbeat": {
        "enabled": true,
        "interval": "30m",
        "mode": "check",
        "suppressOk": true,
        "activeHours": {
          "start": "09:00",
          "end": "22:00",
          "timezone": "UTC"
        },
        "deliverTo": "slack:#alerts"
      },
      "reflection": {
        "enabled": true,
        "interval": 10
      },
      "maxTurns": 25,
      "notifications": {
        "preferredChannel": "slack:#updates",
        "minSeverity": "info",
        "quietHours": {
          "start": "22:00",
          "end": "08:00",
          "timezone": "UTC"
        },
        "batchDigest": false,
        "digestIntervalMinutes": 30
      }
    }
  },

  "channels": {
    "telegram": {
      "enabled": false,
      "token": ""
    },
    "slack": {
      "enabled": false,
      "botToken": "",
      "appToken": ""
    },
    "discord": {
      "enabled": false,
      "token": ""
    },
    "webchat": {
      "enabled": true
    }
  },

  "gateway": {
    "port": 7890,
    "host": "127.0.0.1"
  },

  "routing": {
    "defaultAgent": "",
    "rules": [
      {
        "channel": "slack",
        "channelUserId": "",
        "chatId": "",
        "agentId": ""
      }
    ]
  },

  "skills": {
    "autoApprove": []
  }
}
```

## Agent Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | Required | Display name |
| `description` | string | `""` | Short description |
| `model` | string | `"sonnet"` | Claude model to use |
| `toolPreset` | enum | `"full"` | `potato`, `coding`, `messaging`, `full`, `custom` |
| `customTools` | string[] | `[]` | Tool list when preset is `custom` |
| `skills` | string[] | `[]` | MCP server names to attach |
| `maxTurns` | number | `25` | Max autonomous turns per invocation |

## Heartbeat Config

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Whether heartbeat is active |
| `interval` | enum | `"30m"` | `15m`, `30m`, `1h`, `4h`, `daily` |
| `mode` | enum | `"check"` | `check` (review only) or `work` (take action) |
| `suppressOk` | boolean | `true` | Suppress "HEARTBEAT_OK" results |
| `activeHours` | object | optional | Only run during these hours |
| `deliverTo` | string | optional | Channel to deliver results (`"slack:#alerts"`) |

## Reflection Config

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Whether reflection cycle runs |
| `interval` | number | `10` | Sessions between reflections |

## Notification Config

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `preferredChannel` | string | optional | Where to send updates |
| `minSeverity` | enum | `"info"` | `info`, `warn`, `error`, `critical` |
| `quietHours` | object | optional | Suppress non-critical during these hours |
| `batchDigest` | boolean | `false` | Batch low-severity into digests |
| `digestIntervalMinutes` | number | `30` | Digest interval |

## Routing Rules

Rules are evaluated in order. First match wins. @mentions in message text always take priority over rules.

| Field | Type | Description |
|-------|------|-------------|
| `channel` | string | Channel name (`slack`, `telegram`, `discord`, `webchat`) |
| `channelUserId` | string | Optional — match specific user |
| `chatId` | string | Optional — match specific chat/group |
| `agentId` | string | Agent to route matching messages to |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | If Telegram enabled | Telegram Bot API token |
| `SLACK_BOT_TOKEN` | If Slack enabled | Slack Bot OAuth token |
| `SLACK_APP_TOKEN` | If Slack enabled | Slack App-level token (Socket Mode) |
| `DISCORD_BOT_TOKEN` | If Discord enabled | Discord bot token |
| `CLADE_HOME` | No | Override config directory (default: `~/.clade`) |

## Config Versioning

The `version` field tracks the schema version. When Clade updates, additive-only migrations run automatically. The schema uses `.passthrough()` so unknown fields from future versions are preserved, not stripped.
