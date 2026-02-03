import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Timer, Bot, MessageSquare, Clock, ChevronRight } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Agent {
  id: string
  name: string
  description?: string
  model?: string
  toolPreset?: string
  emoji?: string
}

export interface Session {
  id: string
  agentId?: string
  agent_id?: string
  label?: string
  channel?: string
  status?: string
  lastActiveAt?: string
  last_active_at?: string
  messageCount?: number
}

export interface CronJob {
  id: string
  name: string
  schedule: string
  agentId?: string
  agent_id?: string
  enabled?: boolean
  lastRun?: string
  last_run_at?: string
  prompt?: string
}

interface DashboardPageProps {
  health: any
  agents: Agent[]
  sessions: Session[]
  cronJobs: CronJob[]
  onNavigateToAgent: (id: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds?: number): string {
  if (!seconds) return '--'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatDate(d?: string | null): string {
  if (!d) return '--'
  try {
    return new Date(d).toLocaleString()
  } catch {
    return String(d)
  }
}

// ---------------------------------------------------------------------------
// Stat card colours mapped to CSS variables
// ---------------------------------------------------------------------------

const STAT_ICONS = [Timer, Bot, MessageSquare, Clock] as const

const STAT_COLORS = [
  'text-[hsl(var(--chart-blue))]',
  'text-[hsl(var(--chart-green))]',
  'text-[hsl(var(--chart-purple))]',
  'text-[hsl(var(--chart-yellow))]',
] as const

const STAT_BORDERS = [
  'border-l-[hsl(var(--chart-blue))]',
  'border-l-[hsl(var(--chart-green))]',
  'border-l-[hsl(var(--chart-purple))]',
  'border-l-[hsl(var(--chart-yellow))]',
] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardPage({
  health,
  agents,
  sessions,
  cronJobs,
  onNavigateToAgent,
}: DashboardPageProps) {
  const activeSessions = sessions.filter((s) => s.status === 'active').length

  const stats = [
    { label: 'Uptime', value: formatUptime(health?.uptime) },
    { label: 'Active Agents', value: agents.length },
    { label: 'Active Sessions', value: activeSessions },
    { label: 'Cron Jobs', value: cronJobs.length },
  ]

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold text-foreground">Dashboard</h2>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => {
          const Icon = STAT_ICONS[i]
          return (
            <Card
              key={s.label}
              className={cn(
                "border-l-[3px] transition-transform hover:-translate-y-0.5",
                STAT_BORDERS[i],
              )}
            >
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={cn("h-4 w-4", STAT_COLORS[i])} />
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </span>
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {s.value != null ? s.value : '--'}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Two-column overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Sessions */}
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              Recent Sessions
            </h3>
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions yet.</p>
            ) : (
              <div className="space-y-2">
                {sessions.slice(0, 6).map((s) => {
                  const agentId = s.agentId || s.agent_id || '--'
                  const statusVariant =
                    s.status === 'active'
                      ? 'default'
                      : s.status === 'idle'
                        ? 'secondary'
                        : 'outline'
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between py-2 px-3 rounded-md bg-secondary/50"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-xs shrink-0 text-primary">
                          {agentId}
                        </span>
                        <span className="text-sm truncate text-foreground">
                          {s.label || s.id.slice(0, 12)}
                        </span>
                      </div>
                      <Badge variant={statusVariant} className="shrink-0 capitalize">
                        {s.status || 'unknown'}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Agents overview */}
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              Agents
            </h3>
            {agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No agents configured.
              </p>
            ) : (
              <div className="space-y-2">
                {agents.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between py-2 px-3 rounded-md bg-secondary/50 cursor-pointer hover:bg-secondary transition-colors"
                    onClick={() => onNavigateToAgent(a.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-base shrink-0">
                        {a.emoji || '\u{1F916}'}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate text-foreground">
                          {a.name}
                        </div>
                        <div className="text-xs truncate text-muted-foreground">
                          {a.description || a.id}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary">{a.toolPreset}</Badge>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
