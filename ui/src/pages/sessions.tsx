import { useState, Fragment } from 'react'
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { RefreshCw, MessageSquare, Send, XCircle } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface SessionsPageProps {
  sessions: Session[]
  onRefresh: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d?: string | null): string {
  if (!d) return '--'
  try {
    return new Date(d).toLocaleString()
  } catch {
    return String(d)
  }
}

function statusBadgeVariant(status?: string): 'default' | 'secondary' | 'outline' {
  if (status === 'active') return 'default'
  if (status === 'idle') return 'secondary'
  return 'outline'
}

function statusDotColor(status?: string): string {
  if (status === 'active') return 'bg-[hsl(var(--success))]'
  if (status === 'idle') return 'bg-[hsl(var(--warning))]'
  return 'bg-muted-foreground/40'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionsPage({ sessions, onRefresh }: SessionsPageProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [msgText, setMsgText] = useState('')
  const [sending, setSending] = useState(false)
  const [response, setResponse] = useState<string | null>(null)

  const toggleRow = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
    setMsgText('')
    setResponse(null)
  }

  const sendMessage = async (sessionId: string) => {
    if (!msgText.trim()) return
    setSending(true)
    setResponse(null)
    try {
      const d = await api<{ response?: string }>('/sessions/' + sessionId + '/send', {
        method: 'POST',
        body: { text: msgText },
      })
      setResponse(d.response || 'Message sent successfully.')
      setMsgText('')
      onRefresh()
    } catch (e: any) {
      console.error('Send failed:', e.message)
    }
    setSending(false)
  }

  const terminateSession = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await api('/sessions/' + id, { method: 'DELETE' })
      onRefresh()
    } catch (err: any) {
      console.error('Terminate failed:', err.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Sessions</h2>
        <Button variant="secondary" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <MessageSquare className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No sessions</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Sessions appear when agents start conversations
          </p>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="text-left text-xs font-medium px-4 py-3 text-muted-foreground">
                    Agent
                  </th>
                  <th className="text-left text-xs font-medium px-4 py-3 text-muted-foreground">
                    Label / ID
                  </th>
                  <th className="text-left text-xs font-medium px-4 py-3 text-muted-foreground">
                    Channel
                  </th>
                  <th className="text-left text-xs font-medium px-4 py-3 text-muted-foreground">
                    Status
                  </th>
                  <th className="text-left text-xs font-medium px-4 py-3 text-muted-foreground">
                    Last Active
                  </th>
                  <th className="text-left text-xs font-medium px-4 py-3 text-muted-foreground">
                    Messages
                  </th>
                  <th className="text-right text-xs font-medium px-4 py-3 text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const agentId = s.agentId || s.agent_id || '--'
                  const isExpanded = expandedId === s.id
                  return (
                    <Fragment key={s.id}>
                      <tr
                        className={cn(
                          "border-b cursor-pointer transition-colors hover:bg-secondary/30",
                          isExpanded && "bg-secondary/40",
                        )}
                        onClick={() => toggleRow(s.id)}
                      >
                        <td className="px-4 py-3 text-sm text-foreground">
                          {agentId}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
                            {s.label || s.id.slice(0, 12) + '\u2026'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {s.channel || '--'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className={cn("h-2 w-2 rounded-full", statusDotColor(s.status))} />
                            <Badge variant={statusBadgeVariant(s.status)} className="capitalize text-xs">
                              {s.status || 'unknown'}
                            </Badge>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDate(s.lastActiveAt || s.last_active_at)}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {s.messageCount ?? '--'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {s.status !== 'terminated' && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2.5 text-xs"
                              onClick={(e) => terminateSession(s.id, e)}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Terminate
                            </Button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b">
                          <td colSpan={7} className="px-4 py-4 bg-secondary/20">
                            <div className="flex gap-2 mb-3">
                              <Input
                                value={msgText}
                                onChange={(e) => setMsgText(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && sendMessage(s.id)}
                                placeholder="Send a message to this session..."
                                onClick={(e) => e.stopPropagation()}
                                className="flex-1"
                              />
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  sendMessage(s.id)
                                }}
                                disabled={sending}
                              >
                                <Send className="h-3.5 w-3.5 mr-1.5" />
                                {sending ? 'Sending...' : 'Send'}
                              </Button>
                            </div>
                            {response && (
                              <div
                                className="p-3 rounded-md text-sm bg-background border text-foreground whitespace-pre-wrap max-h-[200px] overflow-auto"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {response}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
