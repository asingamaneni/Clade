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
import { cn } from "@/lib/utils"
import { api } from '@/lib/api'
import { ListTodo, Loader2, X, Clock, CheckCircle2, XCircle, Ban, Timer, RefreshCw } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueuedTask {
  id: string
  agentId: string
  sessionId?: string
  conversationId?: string
  prompt: string
  description: string
  executeAt: string
  scheduledAt: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired'
  result?: string
  error?: string
  retryCount: number
  completedAt?: string
}

interface Agent {
  id: string
  name: string
  emoji?: string
}

interface TaskQueuePageProps {
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

function timeUntil(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const seconds = Math.floor((then - now) / 1000)
  if (seconds <= 0) return 'now'
  if (seconds < 60) return `in ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `in ${days}d ${hours % 24}h`
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof Clock; label: string }> = {
  pending:   { color: 'text-yellow-400', bg: 'bg-yellow-500/10', icon: Clock,        label: 'Pending' },
  running:   { color: 'text-blue-400',   bg: 'bg-blue-500/10',   icon: RefreshCw,    label: 'Running' },
  completed: { color: 'text-green-400',  bg: 'bg-green-500/10',  icon: CheckCircle2, label: 'Completed' },
  failed:    { color: 'text-red-400',    bg: 'bg-red-500/10',    icon: XCircle,      label: 'Failed' },
  cancelled: { color: 'text-gray-400',   bg: 'bg-gray-500/10',   icon: Ban,          label: 'Cancelled' },
  expired:   { color: 'text-gray-400',   bg: 'bg-gray-500/10',   icon: Timer,        label: 'Expired' },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskQueuePage({ agents, wsRef }: TaskQueuePageProps) {
  const [tasks, setTasks] = useState<QueuedTask[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedTask, setSelectedTask] = useState<QueuedTask | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [, setTick] = useState(0)

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const data = await api<{ tasks: QueuedTask[] }>(`/task-queue?${params}`)
      setTasks(data.tasks || [])
    } catch {
      setTasks([])
    }
  }, [statusFilter])

  // Initial load + reload on filter change
  useEffect(() => {
    setLoading(true)
    fetchTasks().finally(() => setLoading(false))
  }, [fetchTasks])

  // WebSocket listener for real-time updates
  useEffect(() => {
    const ws = wsRef.current
    if (!ws) return

    const handler = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type && String(msg.type).startsWith('taskqueue:')) {
          fetchTasks()
        }
      } catch {}
    }

    ws.addEventListener('message', handler)
    return () => ws.removeEventListener('message', handler)
  }, [wsRef, fetchTasks])

  // Countdown ticker for pending tasks
  useEffect(() => {
    const hasPending = tasks.some(t => t.status === 'pending')
    if (hasPending) {
      countdownRef.current = setInterval(() => setTick(t => t + 1), 1000)
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [tasks])

  const cancelTask = async (taskId: string) => {
    try {
      await api(`/task-queue/${taskId}`, { method: 'DELETE' })
      fetchTasks()
    } catch {}
  }

  const pendingTasks = tasks.filter(t => t.status === 'pending' || t.status === 'running')
  const historyTasks = tasks.filter(t => t.status !== 'pending' && t.status !== 'running')

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Task Queue</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Follow-up tasks scheduled by agents for asynchronous execution
        </p>
      </div>

      {/* Status filter */}
      <div className="flex gap-1.5">
        {(['all', 'pending', 'running', 'completed', 'failed', 'cancelled', 'expired'] as const).map(s => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            className="h-7 text-xs capitalize"
            onClick={() => setStatusFilter(s)}
          >
            {s === 'all' ? 'All' : STATUS_CONFIG[s]?.label || s}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ListTodo className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No tasks in queue</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Tasks appear here when agents schedule follow-up work during conversations.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Pending / Running Tasks */}
          {pendingTasks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Active ({pendingTasks.length})
              </h3>
              {pendingTasks.map(task => {
                const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending
                const Icon = cfg.icon
                const agent = agents.find(a => a.id === task.agentId)
                return (
                  <Card
                    key={task.id}
                    className="border-l-[3px] border-l-yellow-500 transition-colors cursor-pointer hover:bg-secondary/30"
                    onClick={() => setSelectedTask(task)}
                  >
                    <CardContent className="p-4 flex items-start gap-3">
                      <div className={cn("mt-0.5 p-1.5 rounded-md", cfg.bg)}>
                        <Icon className={cn("h-3.5 w-3.5", cfg.color, task.status === 'running' && "animate-spin")} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-foreground truncate">
                            {task.description}
                          </span>
                          <Badge variant="secondary" className={cn("text-[10px] h-4 shrink-0", cfg.color)}>
                            {cfg.label}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {task.prompt}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[11px] font-medium text-yellow-400">
                          {timeUntil(task.executeAt)}
                        </span>
                        {agent && (
                          <span className="text-[10px] text-muted-foreground/50">
                            {agent.emoji || ''} {agent.name}
                          </span>
                        )}
                        {task.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 w-5 p-0 text-muted-foreground/50 hover:text-red-400"
                            onClick={(e) => { e.stopPropagation(); cancelTask(task.id) }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Task History */}
          {historyTasks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                History ({historyTasks.length})
              </h3>
              {historyTasks.map(task => {
                const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.completed
                const Icon = cfg.icon
                const agent = agents.find(a => a.id === task.agentId)
                return (
                  <Card
                    key={task.id}
                    className={cn("border-l-[3px] transition-colors cursor-pointer hover:bg-secondary/30",
                      task.status === 'completed' ? 'border-l-green-500' :
                      task.status === 'failed' ? 'border-l-red-500' : 'border-l-gray-500'
                    )}
                    onClick={() => setSelectedTask(task)}
                  >
                    <CardContent className="p-4 flex items-start gap-3">
                      <div className={cn("mt-0.5 p-1.5 rounded-md", cfg.bg)}>
                        <Icon className={cn("h-3.5 w-3.5", cfg.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-foreground truncate">
                            {task.description}
                          </span>
                          <Badge variant="secondary" className={cn("text-[10px] h-4 shrink-0", cfg.color)}>
                            {cfg.label}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {task.result ? task.result.slice(0, 150) : task.error || task.prompt}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[11px] text-muted-foreground/70">
                          {task.completedAt ? timeAgo(task.completedAt) : timeAgo(task.scheduledAt)}
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
            </div>
          )}
        </div>
      )}

      {/* Detail modal */}
      <Dialog open={!!selectedTask} onOpenChange={(open) => { if (!open) setSelectedTask(null) }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          {selectedTask && (() => {
            const cfg = STATUS_CONFIG[selectedTask.status] || STATUS_CONFIG.pending
            const agent = agents.find(a => a.id === selectedTask.agentId)
            const agentLabel = agent ? `${agent.emoji || ''} ${agent.name}` : selectedTask.agentId

            return (
              <>
                <DialogHeader className="flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className={cn("text-xs", cfg.color)}>
                      {cfg.label}
                    </Badge>
                    <DialogTitle className="text-base">{selectedTask.description}</DialogTitle>
                  </div>
                </DialogHeader>
                <div className="space-y-4 overflow-y-auto flex-1 min-h-0 pr-1 scrollbar-visible">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{agentLabel}</span>
                    <span>&middot;</span>
                    <span>Scheduled {new Date(selectedTask.scheduledAt).toLocaleString()}</span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Execute At</span>
                    <div className="text-sm">{new Date(selectedTask.executeAt).toLocaleString()}</div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Prompt</span>
                    <pre className="text-xs whitespace-pre-wrap break-words font-mono rounded-md bg-secondary/50 p-3">
                      {selectedTask.prompt}
                    </pre>
                  </div>

                  {selectedTask.result && (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Result</span>
                      <pre className="text-xs whitespace-pre-wrap break-words font-mono rounded-md bg-secondary/50 p-3">
                        {selectedTask.result}
                      </pre>
                    </div>
                  )}

                  {selectedTask.error && (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Error</span>
                      <pre className="text-xs bg-red-500/10 rounded-md p-3 whitespace-pre-wrap break-words font-mono text-red-400">
                        {selectedTask.error}
                      </pre>
                    </div>
                  )}

                  {selectedTask.retryCount > 0 && (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Retries</span>
                      <div className="text-sm">{selectedTask.retryCount}</div>
                    </div>
                  )}

                  {selectedTask.completedAt && (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Completed At</span>
                      <div className="text-sm">{new Date(selectedTask.completedAt).toLocaleString()}</div>
                    </div>
                  )}

                  {selectedTask.conversationId && (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Conversation</span>
                      <div className="text-xs font-mono text-muted-foreground">{selectedTask.conversationId}</div>
                    </div>
                  )}

                  {selectedTask.status === 'pending' && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => { cancelTask(selectedTask.id); setSelectedTask(null) }}
                    >
                      Cancel Task
                    </Button>
                  )}
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
