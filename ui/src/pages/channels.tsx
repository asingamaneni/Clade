import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { RefreshCw, Radio } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Channel {
  name: string
  connected: boolean
}

interface ChannelsPageProps {
  channels: Channel[]
  onRefresh: () => void
}

// ---------------------------------------------------------------------------
// Channel metadata
// ---------------------------------------------------------------------------

interface ChannelMeta {
  icon: string
  label: string
  tokenLabel: string | null
  desc: string
}

const CHANNEL_META: Record<string, ChannelMeta> = {
  telegram: {
    icon: '\u2708\uFE0F',
    label: 'Telegram',
    tokenLabel: 'TELEGRAM_BOT_TOKEN',
    desc: 'Bot API via grammy',
  },
  slack: {
    icon: '\uD83D\uDCAC',
    label: 'Slack',
    tokenLabel: 'SLACK_BOT_TOKEN',
    desc: 'Socket Mode via @slack/bolt',
  },
  discord: {
    icon: '\uD83C\uDFAE',
    label: 'Discord',
    tokenLabel: 'DISCORD_BOT_TOKEN',
    desc: 'Bot integration via discord.js',
  },
  webchat: {
    icon: '\uD83C\uDF10',
    label: 'WebChat',
    tokenLabel: null,
    desc: 'Built-in browser WebSocket chat',
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChannelsPage({ channels, onRefresh }: ChannelsPageProps) {
  const [tokens, setTokens] = useState<Record<string, string>>({})

  // Build the full list, filling in any channels not returned from API
  const allChannels = Object.keys(CHANNEL_META).map((name) => {
    const found = channels.find((c) => c.name === name)
    return { name, connected: found ? found.connected : false }
  })

  const toggleConnect = async (name: string, connect: boolean) => {
    try {
      await api(
        '/channels/' + name + '/' + (connect ? 'connect' : 'disconnect'),
        { method: 'POST' },
      )
      onRefresh()
    } catch (e: any) {
      console.error('Channel toggle failed:', e.message)
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
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        ch.connected
                          ? "bg-[hsl(var(--success))]"
                          : "bg-destructive",
                      )}
                    />
                    <span
                      className={cn(
                        "text-xs",
                        ch.connected
                          ? "text-[hsl(var(--success))]"
                          : "text-muted-foreground",
                      )}
                    >
                      {ch.connected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                </div>

                {/* Enable toggle */}
                <div className="flex items-center gap-3">
                  <Label htmlFor={`channel-toggle-${ch.name}`} className="text-xs text-muted-foreground">
                    Enable
                  </Label>
                  <Switch
                    id={`channel-toggle-${ch.name}`}
                    checked={ch.connected}
                    onCheckedChange={(checked) => toggleConnect(ch.name, checked)}
                  />
                </div>

                {/* Token input (if applicable) */}
                {meta.tokenLabel && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {meta.tokenLabel}
                    </Label>
                    <Input
                      type="password"
                      value={tokens[ch.name] || ''}
                      onChange={(e) =>
                        setTokens((prev) => ({
                          ...prev,
                          [ch.name]: e.target.value,
                        }))
                      }
                      placeholder="Enter token..."
                    />
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
