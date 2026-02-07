import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { api } from '@/lib/api'
import {
  MessageSquare, Puzzle, BookOpen, Bot, RefreshCw, Loader2, Zap, Search as SearchIcon
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActivityEvent {
  id: string
  type: 'chat' | 'skill' | 'mcp' | 'reflection' | 'agent'
  agentId?: string
  title: string
  description: string
  timestamp: string
  metadata?: Record<string, unknown>
}

interface Agent {
  id: string
  name: string
  emoji?: string
}

interface ActivityPageProps {
  agents: Agent[]
  wsRef: React.RefObject<WebSocket | null>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const seconds = Math.floor((now - then) / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const EVENT_CONFIG: Record<string, { color: string; bg: string; border: string; icon: typeof Zap; label: string }> = {
  chat:       { color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-l-blue-500',   icon: MessageSquare, label: 'Chat' },
  skill:      { color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-l-purple-500', icon: BookOpen,      label: 'Skill' },
  mcp:        { color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-l-green-500',  icon: Puzzle,        label: 'MCP' },
  reflection: { color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-l-amber-500',  icon: RefreshCw,     label: 'Reflection' },
  agent:      { color: 'text-cyan-400',   bg: 'bg-cyan-500/10',   border: 'border-l-cyan-500',   icon: Bot,           label: 'Agent' },
}

const FILTER_TYPES = ['all', 'chat', 'skill', 'mcp', 'reflection', 'agent'] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityPage({ agents, wsRef }: ActivityPageProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [hasMore, setHasMore] = useState(true)
  const offsetRef = useRef(0)

  const fetchEvents = useCallback(async (offset = 0, append = false) => {
    try {
      const params = new URLSearchParams({ limit: '50', offset: String(offset) })
      if (filter !== 'all') params.set('type', filter)
      if (agentFilter !== 'all') params.set('agentId', agentFilter)

      const data = await api<{ events: ActivityEvent[] }>(`/activity?${params}`)
      const fetched = data.events || []

      if (append) {
        setEvents(prev => [...prev, ...fetched])
      } else {
        setEvents(fetched)
      }
      offsetRef.current = offset + fetched.length
      setHasMore(fetched.length >= 50)
    } catch {
      if (!append) setEvents([])
    }
  }, [filter, agentFilter])

  // Initial load + reload on filter change
  useEffect(() => {
    setLoading(true)
    offsetRef.current = 0
    fetchEvents(0, false).finally(() => setLoading(false))
  }, [fetchEvents])

  // WebSocket listener for real-time events
  useEffect(() => {
    const ws = wsRef.current
    if (!ws) return

    const handler = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'activity:new' && msg.event) {
          const evt = msg.event as ActivityEvent
          // Apply current filters
          if (filter !== 'all' && evt.type !== filter) return
          if (agentFilter !== 'all' && evt.agentId !== agentFilter) return
          setEvents(prev => [evt, ...prev])
        }
      } catch {}
    }

    ws.addEventListener('message', handler)
    return () => ws.removeEventListener('message', handler)
  }, [wsRef, filter, agentFilter])

  const loadMore = async () => {
    setLoadingMore(true)
    await fetchEvents(offsetRef.current, true)
    setLoadingMore(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Activity Feed</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time log of all agent actions and system events
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {FILTER_TYPES.map(t => {
            const isActive = filter === t
            const cfg = t !== 'all' ? EVENT_CONFIG[t] : null
            return (
              <Button
                key={t}
                size="sm"
                variant={isActive ? "default" : "outline"}
                className={cn(
                  "h-7 text-xs capitalize",
                  isActive && t !== 'all' && cfg?.bg
                )}
                onClick={() => setFilter(t)}
              >
                {t === 'all' ? 'All' : cfg?.label}
              </Button>
            )
          })}
        </div>

        {agents.length > 0 && (
          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground"
          >
            <option value="all">All agents</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.emoji || ''} {a.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Events */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : events.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Zap className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No activity yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Events will appear here as agents work, skills are installed, and conversations happen.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {events.map(evt => {
            const cfg = EVENT_CONFIG[evt.type] || EVENT_CONFIG.agent
            const Icon = cfg.icon
            const agent = agents.find(a => a.id === evt.agentId)

            return (
              <Card
                key={evt.id}
                className={cn("border-l-[3px] transition-colors", cfg.border)}
              >
                <CardContent className="p-4 flex items-start gap-3">
                  <div className={cn("mt-0.5 p-1.5 rounded-md", cfg.bg)}>
                    <Icon className={cn("h-3.5 w-3.5", cfg.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-foreground truncate">
                        {evt.title}
                      </span>
                      <Badge variant="secondary" className={cn("text-[10px] h-4 shrink-0", cfg.color)}>
                        {cfg.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {evt.description}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[11px] text-muted-foreground/70">
                      {timeAgo(evt.timestamp)}
                    </span>
                    {agent && (
                      <span className="text-[10px] text-muted-foreground/50">
                        {agent.emoji || ''} {agent.name}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={loadingMore}
                className="text-xs"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                    Loading...
                  </>
                ) : (
                  'Load more'
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
