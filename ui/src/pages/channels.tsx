import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { RefreshCw, ExternalLink, CheckCircle2, XCircle } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Channel {
  name: string
  connected: boolean
  configured?: boolean
  hasToken?: boolean
}

interface ChannelsPageProps {
  channels: Channel[]
  onRefresh: () => void
}

// ---------------------------------------------------------------------------
// Channel metadata
// ---------------------------------------------------------------------------

interface TokenInfo {
  label: string
  envVar: string
}

interface ChannelMeta {
  icon: string
  label: string
  tokens: TokenInfo[]
  desc: string
  setupUrl?: string
  setupSteps?: string[]
}

const CHANNEL_META: Record<string, ChannelMeta> = {
  telegram: {
    icon: '\u2708\uFE0F',
    label: 'Telegram',
    tokens: [{ label: 'Bot Token', envVar: 'TELEGRAM_BOT_TOKEN' }],
    desc: 'Bot API via grammy',
    setupUrl: 'https://t.me/BotFather',
    setupSteps: [
      'Message @BotFather on Telegram',
      'Send /newbot and follow the prompts',
      'Set TELEGRAM_BOT_TOKEN env var',
      'Restart the server',
    ],
  },
  slack: {
    icon: '\uD83D\uDCAC',
    label: 'Slack',
    tokens: [
      { label: 'Bot Token', envVar: 'SLACK_BOT_TOKEN' },
      { label: 'App Token', envVar: 'SLACK_APP_TOKEN' },
    ],
    desc: 'Socket Mode via @slack/bolt',
    setupUrl: 'https://api.slack.com/apps',
    setupSteps: [
      'Create a new app at api.slack.com/apps',
      'Enable Socket Mode and get an App Token (xapp-...)',
      'Add bot scopes and install to workspace',
      'Set both SLACK_BOT_TOKEN and SLACK_APP_TOKEN env vars',
      'Restart the server',
    ],
  },
  discord: {
    icon: '\uD83C\uDFAE',
    label: 'Discord',
    tokens: [{ label: 'Bot Token', envVar: 'DISCORD_BOT_TOKEN' }],
    desc: 'Bot integration via discord.js',
    setupUrl: 'https://discord.com/developers/applications',
    setupSteps: [
      'Create an app at discord.com/developers/applications',
      'Add a Bot and copy the token',
      'Enable MESSAGE CONTENT intent in Bot settings',
      'Set DISCORD_BOT_TOKEN env var',
      'Restart the server',
    ],
  },
  webchat: {
    icon: '\uD83C\uDF10',
    label: 'WebChat',
    tokens: [],
    desc: 'Built-in browser WebSocket chat',
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChannelsPage({ channels, onRefresh }: ChannelsPageProps) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})

  // Build the full list, filling in any channels not returned from API
  const allChannels = Object.keys(CHANNEL_META).map((name) => {
    const found = channels.find((c) => c.name === name)
    return {
      name,
      connected: found?.connected ?? false,
      configured: found?.configured ?? false,
      hasToken: found?.hasToken ?? (name === 'webchat'),
    }
  })

  const toggleConnect = async (name: string, connect: boolean) => {
    setErrors((prev) => ({ ...prev, [name]: '' }))
    setLoading((prev) => ({ ...prev, [name]: true }))
    try {
      const res = await api(
        '/channels/' + name + '/' + (connect ? 'connect' : 'disconnect'),
        { method: 'POST' },
      )
      if (res.error) {
        setErrors((prev) => ({ ...prev, [name]: res.error }))
      }
      onRefresh()
    } catch (e: any) {
      setErrors((prev) => ({ ...prev, [name]: e.message || 'Connection failed' }))
    } finally {
      setLoading((prev) => ({ ...prev, [name]: false }))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Channels</h2>
        <Button variant="secondary" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {allChannels.map((ch) => {
          const meta = CHANNEL_META[ch.name]
          if (!meta) return null

          // Determine status
          const status = ch.connected
            ? 'connected'
            : ch.hasToken
              ? 'disconnected'
              : 'not_configured'

          const statusConfig = {
            connected: {
              dotClass: 'bg-[hsl(var(--success))]',
              textClass: 'text-[hsl(var(--success))]',
              label: 'Connected',
            },
            disconnected: {
              dotClass: 'bg-yellow-500',
              textClass: 'text-yellow-500',
              label: 'Disconnected',
            },
            not_configured: {
              dotClass: 'bg-muted-foreground/40',
              textClass: 'text-muted-foreground/60',
              label: 'Not configured',
            },
          }[status]

          const error = errors[ch.name]

          return (
            <Card key={ch.name}>
              <CardContent className="p-5 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{meta.icon}</span>
                    <div>
                      <div className="font-semibold text-sm text-foreground">
                        {meta.label}
                      </div>
                      <div className="text-xs text-muted-foreground/60">
                        {meta.desc}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn("h-2 w-2 rounded-full", statusConfig.dotClass)} />
                    <span className={cn("text-xs", statusConfig.textClass)}>
                      {statusConfig.label}
                    </span>
                  </div>
                </div>

                {/* Enable toggle */}
                <div className="flex items-center gap-3">
                  <Label htmlFor={`channel-toggle-${ch.name}`} className="text-xs text-muted-foreground">
                    {ch.connected ? 'Disconnect' : 'Connect'}
                  </Label>
                  <Switch
                    id={`channel-toggle-${ch.name}`}
                    checked={ch.connected}
                    disabled={loading[ch.name] || (!ch.hasToken && !ch.connected)}
                    onCheckedChange={(checked) => toggleConnect(ch.name, checked)}
                  />
                </div>

                {/* Error message */}
                {error && (
                  <div className="text-xs text-destructive bg-destructive/10 rounded px-2.5 py-1.5">
                    {error}
                  </div>
                )}

                {/* Token / env var status */}
                {meta.tokens.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      Required environment variables
                    </div>
                    {meta.tokens.map((token) => (
                      <div key={token.envVar} className="flex items-center gap-2">
                        {ch.hasToken ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--success))] shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                        )}
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                          {token.envVar}
                        </code>
                        <span className="text-xs text-muted-foreground/60">
                          {token.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Setup guide */}
                {meta.setupSteps && !ch.hasToken && (
                  <div className="space-y-2 border-t border-border/50 pt-3">
                    <div className="text-xs font-medium text-muted-foreground">
                      Setup guide
                    </div>
                    <ol className="text-xs text-muted-foreground/80 space-y-1 list-decimal list-inside">
                      {meta.setupSteps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                    {meta.setupUrl && (
                      <a
                        href={meta.setupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Open developer portal
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
