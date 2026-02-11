import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { api } from '@/lib/api'
import {
  MessageSquare, Puzzle, BookOpen, Bot, RefreshCw, Loader2, Zap, Search as SearchIcon, Heart, Timer, ArrowRightLeft, Calendar, X, ListTodo
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActivityEvent {
  id: string
  type: 'chat' | 'skill' | 'mcp' | 'reflection' | 'agent' | 'heartbeat' | 'cron' | 'delegation' | 'task_queue'
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
  heartbeat:  { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-l-emerald-500', icon: Heart,       label: 'Heartbeat' },
  cron:       { color: 'text-sky-400',   bg: 'bg-sky-500/10',   border: 'border-l-sky-500',   icon: Timer,         label: 'Cron' },
  delegation: { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-l-orange-500', icon: ArrowRightLeft, label: 'Delegation' },
  task_queue: { color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-l-teal-500', icon: ListTodo, label: 'Task Queue' },
}

const FILTER_TYPES = ['all', 'chat', 'skill', 'mcp', 'reflection', 'agent', 'heartbeat', 'cron', 'delegation', 'task_queue'] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      <div>{children}</div>
    </div>
  )
}

function CodeBlock({ text }: { text: string }) {
  return (
    <ScrollArea className="max-h-[300px]">
      <pre className="text-xs bg-secondary/50 rounded-md p-3 whitespace-pre-wrap break-words font-mono">
        {text}
      </pre>
    </ScrollArea>
  )
}

function EventDetailContent({ event, agents }: { event: ActivityEvent; agents: Agent[] }) {
  const meta = event.metadata || {}
  const agent = agents.find(a => a.id === event.agentId)
  const agentLabel = agent ? `${agent.emoji || ''} ${agent.name}` : event.agentId || 'Unknown'

  const commonHeader = (
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
      <span>{agentLabel}</span>
      <span>&middot;</span>
      <span>{new Date(event.timestamp).toLocaleString()}</span>
    </div>
  )

  switch (event.type) {
    case 'chat':
      return (
        <div className="space-y-4">
          {commonHeader}
          {meta.userMessage && (
            <DetailSection label="User Message">
              <CodeBlock text={String(meta.userMessage)} />
            </DetailSection>
          )}
          {meta.assistantMessage && (
            <DetailSection label="Agent Response">
              <CodeBlock text={String(meta.assistantMessage)} />
            </DetailSection>
          )}
          {meta.conversationId && (
            <DetailSection label="Conversation ID">
              <span className="text-xs font-mono text-muted-foreground">{String(meta.conversationId)}</span>
            </DetailSection>
          )}
        </div>
      )

    case 'cron':
      return (
        <div className="space-y-4">
          {commonHeader}
          {meta.action && (
            <DetailSection label="Action">
              <Badge variant="secondary" className="text-xs capitalize">{String(meta.action)}</Badge>
            </DetailSection>
          )}
          {meta.schedule && (
            <DetailSection label="Schedule">
              <span className="text-xs font-mono">{String(meta.schedule)}</span>
            </DetailSection>
          )}
          {meta.prompt && (
            <DetailSection label="Prompt">
              <CodeBlock text={String(meta.prompt)} />
            </DetailSection>
          )}
          {meta.result && (
            <DetailSection label="Response">
              <CodeBlock text={String(meta.result)} />
            </DetailSection>
          )}
          {meta.error && (
            <DetailSection label="Error">
              <CodeBlock text={String(meta.error)} />
            </DetailSection>
          )}
          {meta.changes && (
            <DetailSection label="Changes">
              <CodeBlock text={JSON.stringify(meta.changes, null, 2)} />
            </DetailSection>
          )}
        </div>
      )

    case 'agent':
      return (
        <div className="space-y-4">
          {commonHeader}
          {meta.action && (
            <DetailSection label="Action">
              <Badge variant="secondary" className="text-xs capitalize">{String(meta.action)}</Badge>
            </DetailSection>
          )}
          {meta.template && (
            <DetailSection label="Template">
              <span className="text-sm">{String(meta.template)}</span>
            </DetailSection>
          )}
          <DetailSection label="Description">
            <p className="text-sm">{event.description}</p>
          </DetailSection>
        </div>
      )

    case 'skill':
      return (
        <div className="space-y-4">
          {commonHeader}
          {meta.action && (
            <DetailSection label="Action">
              <Badge variant="secondary" className="text-xs capitalize">{String(meta.action)}</Badge>
            </DetailSection>
          )}
          {meta.skillName && (
            <DetailSection label="Skill">
              <span className="text-sm font-medium">{String(meta.skillName)}</span>
            </DetailSection>
          )}
          <DetailSection label="Description">
            <p className="text-sm">{event.description}</p>
          </DetailSection>
        </div>
      )

    case 'mcp':
      return (
        <div className="space-y-4">
          {commonHeader}
          {meta.action && (
            <DetailSection label="Action">
              <Badge variant="secondary" className="text-xs capitalize">{String(meta.action)}</Badge>
            </DetailSection>
          )}
          {meta.serverName && (
            <DetailSection label="Server">
              <span className="text-sm font-medium">{String(meta.serverName)}</span>
            </DetailSection>
          )}
          <DetailSection label="Description">
            <p className="text-sm">{event.description}</p>
          </DetailSection>
        </div>
      )

    case 'heartbeat':
      return (
        <div className="space-y-4">
          {commonHeader}
          {meta.response && (
            <DetailSection label="Response">
              <CodeBlock text={String(meta.response)} />
            </DetailSection>
          )}
          {meta.status && (
            <DetailSection label="Status">
              <Badge variant="secondary" className="text-xs capitalize">{String(meta.status)}</Badge>
            </DetailSection>
          )}
          <DetailSection label="Description">
            <p className="text-sm">{event.description}</p>
          </DetailSection>
        </div>
      )

    case 'reflection':
      return (
        <div className="space-y-4">
          {commonHeader}
          {meta.changes && (
            <DetailSection label="Changes to SOUL.md">
              <CodeBlock text={String(meta.changes)} />
            </DetailSection>
          )}
          <DetailSection label="Description">
            <p className="text-sm">{event.description}</p>
          </DetailSection>
        </div>
      )

    case 'delegation':
      return (
        <div className="space-y-4">
          {commonHeader}
          <DetailSection label="DESCRIPTION">
            <pre className="text-sm bg-secondary/50 rounded-md p-3 whitespace-pre-wrap break-words">
              {event.description}
            </pre>
          </DetailSection>
        </div>
      )

    default:
      return (
        <div className="space-y-4">
          {commonHeader}
          <DetailSection label="Description">
            <p className="text-sm">{event.description}</p>
          </DetailSection>
          {Object.keys(meta).length > 0 && (
            <DetailSection label="Metadata">
              <CodeBlock text={JSON.stringify(meta, null, 2)} />
            </DetailSection>
          )}
        </div>
      )
  }
}

export function ActivityPage({ agents, wsRef }: ActivityPageProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [datePreset, setDatePreset] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [hasMore, setHasMore] = useState(true)
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null)
  const offsetRef = useRef(0)

  // Compute effective from/to ISO strings from preset or custom inputs
  const getDateRange = useCallback((): { from?: string; to?: string } => {
    if (datePreset === 'custom') {
      return {
        from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        to: dateTo ? new Date(dateTo + 'T23:59:59.999').toISOString() : undefined,
      }
    }
    if (datePreset === 'all') return {}
    const now = new Date()
    const startOfDay = (d: Date) => { d.setHours(0, 0, 0, 0); return d }
    switch (datePreset) {
      case 'today':
        return { from: startOfDay(new Date(now)).toISOString() }
      case 'yesterday': {
        const yStart = startOfDay(new Date(now))
        yStart.setDate(yStart.getDate() - 1)
        const yEnd = new Date(yStart)
        yEnd.setHours(23, 59, 59, 999)
        return { from: yStart.toISOString(), to: yEnd.toISOString() }
      }
      case '7d':
        return { from: new Date(now.getTime() - 7 * 86400000).toISOString() }
      case '30d':
        return { from: new Date(now.getTime() - 30 * 86400000).toISOString() }
      default: return {}
    }
  }, [datePreset, dateFrom, dateTo])

  const fetchEvents = useCallback(async (offset = 0, append = false) => {
    try {
      const params = new URLSearchParams({ limit: '50', offset: String(offset) })
      if (filter !== 'all') params.set('type', filter)
      if (agentFilter !== 'all') params.set('agentId', agentFilter)
      const range = getDateRange()
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)

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
  }, [filter, agentFilter, getDateRange])

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
          // Apply date filter — only check if date range excludes future/past
          const range = getDateRange()
          if (range.from && new Date(evt.timestamp).getTime() < new Date(range.from).getTime()) return
          if (range.to && new Date(evt.timestamp).getTime() > new Date(range.to).getTime()) return
          setEvents(prev => [evt, ...prev])
        }
      } catch {}
    }

    ws.addEventListener('message', handler)
    return () => ws.removeEventListener('message', handler)
  }, [wsRef, filter, agentFilter, getDateRange])

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

      {/* Date range filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
        {(['all', 'today', 'yesterday', '7d', '30d', 'custom'] as const).map(preset => (
          <Button
            key={preset}
            size="sm"
            variant={datePreset === preset ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => {
              setDatePreset(preset)
              if (preset !== 'custom') { setDateFrom(''); setDateTo('') }
            }}
          >
            {preset === 'all' ? 'All time' : preset === 'today' ? 'Today' : preset === 'yesterday' ? 'Yesterday' : preset === '7d' ? 'Last 7 days' : preset === '30d' ? 'Last 30 days' : 'Custom'}
          </Button>
        ))}
        {datePreset === 'custom' && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground"
            />
            {(dateFrom || dateTo) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => { setDateFrom(''); setDateTo('') }}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Type & agent filters */}
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
                className={cn("border-l-[3px] transition-colors cursor-pointer hover:bg-secondary/30", cfg.border)}
                onClick={() => setSelectedEvent(evt)}
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

      {/* Detail modal */}
      <Dialog open={!!selectedEvent} onOpenChange={(open) => { if (!open) setSelectedEvent(null) }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          {selectedEvent && (() => {
            const cfg = EVENT_CONFIG[selectedEvent.type] || EVENT_CONFIG.agent
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className={cn("text-xs", cfg.color)}>
                      {cfg.label}
                    </Badge>
                    <DialogTitle className="text-base">{selectedEvent.title}</DialogTitle>
                  </div>
                </DialogHeader>
                <EventDetailContent event={selectedEvent} agents={agents} />
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
