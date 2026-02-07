import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { api } from '@/lib/api'
import { ChevronLeft, ChevronRight, Loader2, CalendarDays } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalendarEvent {
  id: string
  type: string
  agentId?: string
  title: string
  start: string
  end?: string
  recurring?: boolean
  color?: string
}

interface Agent {
  id: string
  name: string
  emoji?: string
}

interface CalendarPageProps {
  agents: Agent[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOURS = Array.from({ length: 24 }, (_, i) => i) // 12 AM - 11 PM
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const AGENT_COLORS = [
  'bg-blue-500/30 border-blue-500/50 text-blue-300',
  'bg-green-500/30 border-green-500/50 text-green-300',
  'bg-purple-500/30 border-purple-500/50 text-purple-300',
  'bg-amber-500/30 border-amber-500/50 text-amber-300',
  'bg-cyan-500/30 border-cyan-500/50 text-cyan-300',
  'bg-pink-500/30 border-pink-500/50 text-pink-300',
  'bg-orange-500/30 border-orange-500/50 text-orange-300',
  'bg-teal-500/30 border-teal-500/50 text-teal-300',
]

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return end
}

function formatWeekRange(start: Date): string {
  const end = new Date(start)
  end.setDate(end.getDate() + 6)

  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const startStr = start.toLocaleDateString('en-US', opts)
  const endStr = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })
  return `${startStr} - ${endStr}`
}

function formatHour(h: number): string {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CalendarPage({ agents }: CalendarPageProps) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const weekEnd = useMemo(() => getWeekEnd(weekStart), [weekStart])

  const agentColorMap = useMemo(() => {
    const map: Record<string, string> = {}
    agents.forEach((a, i) => {
      map[a.id] = AGENT_COLORS[i % AGENT_COLORS.length]
    })
    return map
  }, [agents])

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
      })
      const data = await api<{ events: CalendarEvent[] }>(`/calendar/events?${params}`)
      setEvents(data.events || [])
    } catch {
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [weekStart, weekEnd])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  // Auto-scroll to 8 AM on load
  useEffect(() => {
    if (!loading && scrollRef.current) {
      scrollRef.current.scrollTop = 8 * 48 // 8 AM
    }
  }, [loading])

  const prevWeek = () => {
    setWeekStart(prev => {
      const d = new Date(prev)
      d.setDate(d.getDate() - 7)
      return d
    })
  }

  const nextWeek = () => {
    setWeekStart(prev => {
      const d = new Date(prev)
      d.setDate(d.getDate() + 7)
      return d
    })
  }

  const goToday = () => setWeekStart(getWeekStart(new Date()))

  // Build day columns
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [weekStart])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Position events on the grid
  const getEventStyle = (evt: CalendarEvent, dayIndex: number) => {
    const start = new Date(evt.start)
    const startHour = start.getHours() + start.getMinutes() / 60
    const endDate = evt.end ? new Date(evt.end) : new Date(start.getTime() + 30 * 60000)
    const endHour = endDate.getHours() + endDate.getMinutes() / 60
    const duration = Math.max(endHour - startHour, 0.5)

    const top = startHour * 48 // 48px per hour
    const height = Math.max(duration * 48, 20)

    return { top: `${top}px`, height: `${height}px` }
  }

  // Group events by day
  const eventsByDay = useMemo(() => {
    const map: Record<number, CalendarEvent[]> = {}
    for (let i = 0; i < 7; i++) map[i] = []

    events.forEach(evt => {
      const start = new Date(evt.start)
      const dayIdx = days.findIndex(d =>
        d.getFullYear() === start.getFullYear() &&
        d.getMonth() === start.getMonth() &&
        d.getDate() === start.getDate()
      )
      if (dayIdx >= 0) map[dayIdx].push(evt)
    })
    return map
  }, [events, days])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Calendar</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Agent activity and scheduled tasks
          </p>
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={prevWeek} className="h-8 w-8 p-0">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium text-foreground min-w-[200px] text-center">
          {formatWeekRange(weekStart)}
        </span>
        <Button variant="outline" size="sm" onClick={nextWeek} className="h-8 w-8 p-0">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={goToday} className="h-8 text-xs">
          Today
        </Button>
      </div>

      {/* Agent legend */}
      {agents.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {agents.map(a => {
            const colors = agentColorMap[a.id] || AGENT_COLORS[0]
            return (
              <div key={a.id} className="flex items-center gap-1.5">
                <div className={cn("w-3 h-3 rounded-sm border", colors.split(' ').slice(0, 2).join(' '))} />
                <span className="text-xs text-muted-foreground">{a.emoji || ''} {a.name}</span>
              </div>
            )
          })}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {/* Header row */}
            <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border">
              <div className="p-2" />
              {days.map((d, i) => {
                const isToday = d.getTime() === today.getTime()
                return (
                  <div key={i} className="p-2 text-center border-l border-border">
                    <div className="text-[11px] text-muted-foreground uppercase">
                      {DAYS[d.getDay()]}
                    </div>
                    <div className={cn(
                      "text-lg font-semibold mt-0.5",
                      isToday
                        ? "text-primary bg-primary/15 rounded-full w-8 h-8 flex items-center justify-center mx-auto"
                        : "text-foreground"
                    )}>
                      {d.getDate()}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Time grid */}
            <div ref={scrollRef} className="relative overflow-y-auto" style={{ maxHeight: '600px' }}>
              <div className="grid grid-cols-[60px_repeat(7,1fr)]" style={{ minHeight: `${HOURS.length * 48}px` }}>
                {/* Hour labels */}
                <div className="relative">
                  {HOURS.map(h => (
                    <div
                      key={h}
                      className="absolute right-2 text-[10px] text-muted-foreground/60"
                      style={{ top: `${h * 48}px`, transform: 'translateY(-6px)' }}
                    >
                      {formatHour(h)}
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {days.map((_, dayIdx) => (
                  <div key={dayIdx} className="relative border-l border-border">
                    {/* Hour grid lines */}
                    {HOURS.map(h => (
                      <div
                        key={h}
                        className="absolute w-full border-t border-border/30"
                        style={{ top: `${h * 48}px` }}
                      />
                    ))}

                    {/* Events */}
                    {(eventsByDay[dayIdx] || []).map(evt => {
                      const style = getEventStyle(evt, dayIdx)
                      const colors = evt.agentId && agentColorMap[evt.agentId]
                        ? agentColorMap[evt.agentId]
                        : 'bg-primary/20 border-primary/40 text-primary'
                      const agent = agents.find(a => a.id === evt.agentId)

                      return (
                        <div
                          key={evt.id}
                          className={cn(
                            "absolute left-1 right-1 rounded-md border px-1.5 py-0.5 cursor-pointer",
                            "hover:brightness-125 transition-all overflow-hidden",
                            colors
                          )}
                          style={style}
                          onClick={() => setSelectedEvent(evt)}
                        >
                          <div className="text-[10px] font-medium truncate">
                            {evt.title}
                          </div>
                          {parseFloat(style.height) > 30 && agent && (
                            <div className="text-[9px] opacity-70 truncate">
                              {agent.emoji || ''} {agent.name}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Event detail dialog */}
      <Dialog open={!!selectedEvent} onOpenChange={(open) => { if (!open) setSelectedEvent(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedEvent?.title}</DialogTitle>
            <DialogDescription>Event details</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {selectedEvent?.agentId && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Agent:</span>
                <span className="text-foreground">{agents.find(a => a.id === selectedEvent.agentId)?.name || selectedEvent.agentId}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Type:</span>
              <Badge variant="secondary" className="text-xs">{selectedEvent?.type}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Start:</span>
              <span className="text-foreground">{selectedEvent ? new Date(selectedEvent.start).toLocaleString() : ''}</span>
            </div>
            {selectedEvent?.end && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">End:</span>
                <span className="text-foreground">{new Date(selectedEvent.end).toLocaleString()}</span>
              </div>
            )}
            {selectedEvent?.recurring && (
              <Badge variant="outline" className="text-xs">Recurring</Badge>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {!loading && events.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CalendarDays className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No events this week</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Agent conversations and scheduled tasks will appear here.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
