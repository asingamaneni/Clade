# Channels

Clade connects your agents to messaging platforms. Messages from any channel are routed to the appropriate agent.

## @mention Routing

Use @mentions to address specific agents in any channel:

```
@jarvis fix the failing tests in auth
@researcher what are the latest papers on RAG?
@ops check the production logs for errors
```

Routing priority:
1. **@mention** — `@jarvis do X` routes to the `jarvis` agent
2. **Routing rules** — Channel/user/chat rules in config
3. **User mapping** — Stored user-to-agent assignments
4. **Default agent** — Fallback from `routing.defaultAgent`

Mentions are case-insensitive. The @mention is stripped from the text before the agent sees it.

## Slack

### Setup

1. Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable **Socket Mode** and generate an App-Level Token (`xapp-...`)
3. Add **Bot Token Scopes**: `chat:write`, `app_mentions:read`, `channels:history`, `im:history`
4. Install the app to your workspace and copy the Bot Token (`xoxb-...`)

### Configuration

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
```

Or set in `~/.clade/config.json`:

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "botToken": "xoxb-...",
      "appToken": "xapp-..."
    }
  }
}
```

Then start the gateway:

```bash
clade start
```

## Telegram

### Setup

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Create a new bot with `/newbot`
3. Copy the token

### Configuration

```bash
export TELEGRAM_BOT_TOKEN=123456:ABC...
```

Or in config:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "123456:ABC..."
    }
  }
}
```

## Discord

### Setup

1. Create an application at [discord.com/developers](https://discord.com/developers/applications)
2. Go to **Bot** tab, create a bot, copy the token
3. Enable **Message Content Intent** under Privileged Gateway Intents
4. Invite the bot to your server with the OAuth2 URL generator (scopes: `bot`, permissions: `Send Messages`, `Read Message History`)

### Configuration

```bash
export DISCORD_BOT_TOKEN=...
```

Or in config:

```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "token": "..."
    }
  }
}
```

## Web Chat

Web chat is enabled by default. Access it at `http://localhost:7890/admin` when the gateway is running. No additional setup needed.

## Routing Rules

For advanced routing, configure rules in `config.json`:

```json
{
  "routing": {
    "defaultAgent": "jarvis",
    "rules": [
      { "channel": "slack", "chatId": "C-ops-alerts", "agentId": "ops" },
      { "channel": "telegram", "channelUserId": "12345", "agentId": "personal" }
    ]
  }
}
```

Rules are evaluated in order. First match wins. @mentions always take priority over rules.
