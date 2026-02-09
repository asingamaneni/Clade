import { useState, useEffect, useCallback } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { showToast } from "@/App"
import {
  RefreshCw,
  GitBranch,
  ArrowRight,
  MessageCircle,
  Users,
  Plus,
  Send,
  Bell,
  BellOff,
  Eye,
  Loader2,
  CheckCircle2,
  Clock,
  PlayCircle,
  XCircle,
  AlertCircle,
  Hash,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Agent {
  id: string
  name: string
  emoji?: string
}

interface Delegation {
  id: string
  fromAgent: string
  toAgent: string
  task: string
  context: string
  constraints?: string
  status: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'failed'
  result?: string
  createdAt: string
  updatedAt: string
}

interface TopicInfo {
  name: string
  messageCount: number
}

interface TopicMessage {
  id: string
  topic: string
  fromAgent: string
  payload: string
  timestamp: string
}

interface Subscription {
  agentId: string
  topic: string
  createdAt: string
}

interface CollaborationPageProps {
  agents: Agent[]
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const statusConfig: Record<string, { label: string; color: string; icon: React.ComponentType<any> }> = {
  pending: { label: 'Pending', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', icon: Clock },
  accepted: { label: 'Accepted', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30', icon: CheckCircle2 },
  in_progress: { label: 'In Progress', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30', icon: PlayCircle },
  completed: { label: 'Completed', color: 'bg-green-500/15 text-green-400 border-green-500/30', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-red-500/15 text-red-400 border-red-500/30', icon: XCircle },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] || { label: status, color: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30', icon: AlertCircle }
  return (
    <Badge variant="outline" className={`${cfg.color} text-xs`}>
      {cfg.label}
    </Badge>
  )
}

function agentName(id: string, agents: Agent[]): string {
  const a = agents.find(a => a.id === id)
  return a ? `${a.emoji || '🤖'} ${a.name}` : id
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CollaborationPage({ agents }: CollaborationPageProps) {
  const [tab, setTab] = useState<'delegations' | 'messages' | 'subscriptions'>('delegations')
  const [loading, setLoading] = useState(false)

  // Delegations state
  const [delegations, setDelegations] = useState<Delegation[]>([])
  const [showCreateDelegation, setShowCreateDelegation] = useState(false)
  const [selectedDelegation, setSelectedDelegation] = useState<Delegation | null>(null)
  const [delegForm, setDelegForm] = useState({ fromAgent: '', toAgent: '', task: '', context: '', constraints: '' })
  const [creating, setCreating] = useState(false)

  // Message bus state
  const [topics, setTopics] = useState<TopicInfo[]>([])
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
  const [messages, setMessages] = useState<TopicMessage[]>([])
  const [publishForm, setPublishForm] = useState({ topic: '', fromAgent: '', payload: '' })
  const [showPublish, setShowPublish] = useState(false)
  const [publishing, setPublishing] = useState(false)

  // Subscriptions state
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [subForm, setSubForm] = useState({ agentId: '', topic: '' })

  // ── Fetchers ──────────────────────────────────────────────

  const fetchDelegations = useCallback(async () => {
    try {
      const d = await api<{ delegations: Delegation[] }>('/collaborations/delegations')
      setDelegations((d.delegations || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    } catch {}
  }, [])

  const fetchTopics = useCallback(async () => {
    try {
      const d = await api<{ topics: TopicInfo[] }>('/collaborations/topics')
      setTopics(d.topics || [])
    } catch {}
  }, [])

  const fetchMessages = useCallback(async (topic: string) => {
    try {
      const d = await api<{ messages: TopicMessage[] }>(`/collaborations/messages/${encodeURIComponent(topic)}`)
      setMessages((d.messages || []).sort((a, b) => b.timestamp.localeCompare(a.timestamp)))
    } catch {}
  }, [])

  const fetchSubscriptions = useCallback(async () => {
    try {
      const d = await api<{ subscriptions: Subscription[] }>('/collaborations/subscriptions')
      setSubscriptions(d.subscriptions || [])
    } catch {}
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    await Promise.allSettled([fetchDelegations(), fetchTopics(), fetchSubscriptions()])
    setLoading(false)
  }, [fetchDelegations, fetchTopics, fetchSubscriptions])

  useEffect(() => { refresh() }, [])

  useEffect(() => {
    if (selectedTopic) fetchMessages(selectedTopic)
  }, [selectedTopic, fetchMessages])

  // ── Delegation actions ────────────────────────────────────

  const handleCreateDelegation = async () => {
    if (!delegForm.fromAgent || !delegForm.toAgent || !delegForm.task || !delegForm.context) return
    setCreating(true)
    try {
      await api('/collaborations/delegations', {
        method: 'POST',
        body: JSON.stringify({
          fromAgent: delegForm.fromAgent,
          toAgent: delegForm.toAgent,
          task: delegForm.task,
          context: delegForm.context,
          constraints: delegForm.constraints || undefined,
        }),
      })
      showToast('Delegation created', 'success')
      setShowCreateDelegation(false)
      setDelegForm({ fromAgent: '', toAgent: '', task: '', context: '', constraints: '' })
      fetchDelegations()
    } catch (e: any) {
      showToast(e.message || 'Failed to create delegation', 'error')
    }
    setCreating(false)
  }

  const handleUpdateDelegation = async (id: string, status: string, result?: string) => {
    try {
      await api(`/collaborations/delegations/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status, result }),
      })
      showToast(`Delegation ${status}`, 'success')
      fetchDelegations()
      setSelectedDelegation(null)
    } catch (e: any) {
      showToast(e.message || 'Failed to update', 'error')
    }
  }

  // ── Publish action ────────────────────────────────────────

  const handlePublish = async () => {
    if (!publishForm.topic || !publishForm.fromAgent || !publishForm.payload) return
    setPublishing(true)
    try {
      await api(`/collaborations/topics/${encodeURIComponent(publishForm.topic)}/publish`, {
        method: 'POST',
        body: JSON.stringify({ fromAgent: publishForm.fromAgent, payload: publishForm.payload }),
      })
      showToast('Message published', 'success')
      setShowPublish(false)
      setPublishForm({ topic: '', fromAgent: '', payload: '' })
      fetchTopics()
      if (selectedTopic === publishForm.topic) fetchMessages(publishForm.topic)
    } catch (e: any) {
      showToast(e.message || 'Failed to publish', 'error')
    }
    setPublishing(false)
  }

  // ── Subscription actions ──────────────────────────────────

  const handleSubscribe = async () => {
    if (!subForm.agentId || !subForm.topic) return
    try {
      await api('/collaborations/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ agentId: subForm.agentId, topic: subForm.topic }),
      })
      showToast('Subscribed', 'success')
      setSubForm({ agentId: '', topic: '' })
      fetchSubscriptions()
    } catch (e: any) {
      showToast(e.message || 'Failed to subscribe', 'error')
    }
  }

  const handleUnsubscribe = async (agentId: string, topic: string) => {
    try {
      await api('/collaborations/subscriptions', {
        method: 'DELETE',
        body: JSON.stringify({ agentId, topic }),
      })
      showToast('Unsubscribed', 'success')
      fetchSubscriptions()
    } catch (e: any) {
      showToast(e.message || 'Failed to unsubscribe', 'error')
    }
  }

  // ── Tab buttons ───────────────────────────────────────────

  const tabs = [
    { id: 'delegations' as const, label: 'Delegations', icon: GitBranch, count: delegations.length },
    { id: 'messages' as const, label: 'Message Bus', icon: MessageCircle, count: topics.length },
    { id: 'subscriptions' as const, label: 'Subscriptions', icon: Users, count: subscriptions.length },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Collaboration</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Agent delegation, pub/sub messaging, and shared memory
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2">
        {tabs.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <Button
              key={t.id}
              variant={active ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTab(t.id)}
              className={active ? '' : 'text-muted-foreground'}
            >
              <Icon className="h-4 w-4 mr-1.5" />
              {t.label}
              {t.count > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
                  {t.count}
                </Badge>
              )}
            </Button>
          )
        })}
      </div>

      {/* ── Delegations tab ─────────────────────────────────── */}
      {tab === 'delegations' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowCreateDelegation(true)} disabled={agents.length < 2}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Delegation
            </Button>
          </div>

          {delegations.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <GitBranch className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No delegations yet</p>
                <p className="text-xs mt-1">Create a delegation to assign tasks between agents</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {delegations.map(d => (
                <Card
                  key={d.id}
                  className="cursor-pointer hover:border-sidebar-accent/30 transition-colors"
                  onClick={() => setSelectedDelegation(d)}
                >
                  <CardContent className="py-4 px-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium shrink-0">{agentName(d.fromAgent, agents)}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium shrink-0">{agentName(d.toAgent, agents)}</span>
                      </div>
                      <StatusBadge status={d.status} />
                    </div>
                    <p className="text-sm text-foreground mt-2 line-clamp-2">{d.task}</p>
                    <p className="text-xs text-muted-foreground mt-1">{timeAgo(d.createdAt)}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Create delegation dialog */}
          <Dialog open={showCreateDelegation} onOpenChange={setShowCreateDelegation}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Create Delegation</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">From Agent</label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={delegForm.fromAgent}
                    onChange={e => setDelegForm(p => ({ ...p, fromAgent: e.target.value }))}
                  >
                    <option value="">Select agent...</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.emoji || '🤖'} {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">To Agent</label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={delegForm.toAgent}
                    onChange={e => setDelegForm(p => ({ ...p, toAgent: e.target.value }))}
                  >
                    <option value="">Select agent...</option>
                    {agents.filter(a => a.id !== delegForm.fromAgent).map(a => (
                      <option key={a.id} value={a.id}>{a.emoji || '🤖'} {a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Task</label>
                  <Input
                    placeholder="What should the agent do?"
                    value={delegForm.task}
                    onChange={e => setDelegForm(p => ({ ...p, task: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Context</label>
                  <textarea
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[80px] resize-y"
                    placeholder="Background info, relevant files, constraints..."
                    value={delegForm.context}
                    onChange={e => setDelegForm(p => ({ ...p, context: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Constraints (optional)</label>
                  <Input
                    placeholder="e.g., Only modify src/utils/"
                    value={delegForm.constraints}
                    onChange={e => setDelegForm(p => ({ ...p, constraints: e.target.value }))}
                  />
                </div>
                <Button className="w-full" onClick={handleCreateDelegation} disabled={creating || !delegForm.fromAgent || !delegForm.toAgent || !delegForm.task || !delegForm.context}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                  Create Delegation
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Delegation detail dialog */}
          <Dialog open={!!selectedDelegation} onOpenChange={() => setSelectedDelegation(null)}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  Delegation
                  {selectedDelegation && <StatusBadge status={selectedDelegation.status} />}
                </DialogTitle>
              </DialogHeader>
              {selectedDelegation && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{agentName(selectedDelegation.fromAgent, agents)}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{agentName(selectedDelegation.toAgent, agents)}</span>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Task</label>
                    <p className="text-sm bg-muted/30 rounded-md p-3">{selectedDelegation.task}</p>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Context</label>
                    <p className="text-sm bg-muted/30 rounded-md p-3 whitespace-pre-wrap max-h-40 overflow-y-auto">{selectedDelegation.context}</p>
                  </div>

                  {selectedDelegation.constraints && (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Constraints</label>
                      <p className="text-sm bg-muted/30 rounded-md p-3">{selectedDelegation.constraints}</p>
                    </div>
                  )}

                  {selectedDelegation.result && (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Result</label>
                      <p className="text-sm bg-green-500/5 border border-green-500/20 rounded-md p-3 whitespace-pre-wrap">{selectedDelegation.result}</p>
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    Created {new Date(selectedDelegation.createdAt).toLocaleString()} · Updated {timeAgo(selectedDelegation.updatedAt)}
                  </div>

                  {/* Status update buttons */}
                  {selectedDelegation.status !== 'completed' && selectedDelegation.status !== 'failed' && (
                    <div className="flex gap-2 pt-2 border-t">
                      {selectedDelegation.status === 'pending' && (
                        <Button size="sm" variant="outline" onClick={() => handleUpdateDelegation(selectedDelegation.id, 'accepted')}>
                          Accept
                        </Button>
                      )}
                      {(selectedDelegation.status === 'pending' || selectedDelegation.status === 'accepted') && (
                        <Button size="sm" variant="outline" onClick={() => handleUpdateDelegation(selectedDelegation.id, 'in_progress')}>
                          Start Work
                        </Button>
                      )}
                      <Button size="sm" onClick={() => handleUpdateDelegation(selectedDelegation.id, 'completed')}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        Complete
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleUpdateDelegation(selectedDelegation.id, 'failed')}>
                        <XCircle className="h-3.5 w-3.5 mr-1" />
                        Failed
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* ── Message Bus tab ─────────────────────────────────── */}
      {tab === 'messages' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowPublish(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Publish Message
            </Button>
          </div>

          <div className="grid grid-cols-12 gap-4">
            {/* Topic list */}
            <div className="col-span-4">
              <Card>
                <CardContent className="p-0">
                  <div className="px-4 py-3 border-b">
                    <h3 className="text-sm font-medium">Topics</h3>
                  </div>
                  {topics.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground text-sm">
                      <Hash className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      No topics yet
                    </div>
                  ) : (
                    <ScrollArea className="max-h-[400px]">
                      {topics.map(t => (
                        <button
                          key={t.name}
                          className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted/30 transition-colors ${selectedTopic === t.name ? 'bg-muted/40' : ''}`}
                          onClick={() => setSelectedTopic(t.name)}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium flex items-center gap-1.5">
                              <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                              {t.name}
                            </span>
                            <Badge variant="secondary" className="text-[10px]">{t.messageCount}</Badge>
                          </div>
                        </button>
                      ))}
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Messages panel */}
            <div className="col-span-8">
              <Card>
                <CardContent className="p-0">
                  <div className="px-4 py-3 border-b">
                    <h3 className="text-sm font-medium">
                      {selectedTopic ? (
                        <span className="flex items-center gap-1.5">
                          <Hash className="h-3.5 w-3.5" />
                          {selectedTopic}
                        </span>
                      ) : 'Select a topic'}
                    </h3>
                  </div>
                  {!selectedTopic ? (
                    <div className="py-12 text-center text-muted-foreground text-sm">
                      <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      Select a topic to view messages
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground text-sm">
                      No messages in this topic
                    </div>
                  ) : (
                    <ScrollArea className="max-h-[400px]">
                      {messages.map(m => (
                        <div key={m.id} className="px-4 py-3 border-b last:border-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium">{agentName(m.fromAgent, agents)}</span>
                            <span className="text-xs text-muted-foreground">{timeAgo(m.timestamp)}</span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">{m.payload}</p>
                        </div>
                      ))}
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Publish dialog */}
          <Dialog open={showPublish} onOpenChange={setShowPublish}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Publish Message</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Topic</label>
                  <Input
                    placeholder="e.g., code-reviews, deployments"
                    value={publishForm.topic}
                    onChange={e => setPublishForm(p => ({ ...p, topic: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">From Agent</label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={publishForm.fromAgent}
                    onChange={e => setPublishForm(p => ({ ...p, fromAgent: e.target.value }))}
                  >
                    <option value="">Select agent...</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.emoji || '🤖'} {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Message</label>
                  <textarea
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[100px] resize-y"
                    placeholder="Message content..."
                    value={publishForm.payload}
                    onChange={e => setPublishForm(p => ({ ...p, payload: e.target.value }))}
                  />
                </div>
                <Button className="w-full" onClick={handlePublish} disabled={publishing || !publishForm.topic || !publishForm.fromAgent || !publishForm.payload}>
                  {publishing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                  Publish
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* ── Subscriptions tab ───────────────────────────────── */}
      {tab === 'subscriptions' && (
        <div className="space-y-4">
          {/* Subscribe form */}
          <Card>
            <CardContent className="py-4 px-5">
              <h3 className="text-sm font-medium mb-3">Subscribe Agent to Topic</h3>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1 block">Agent</label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={subForm.agentId}
                    onChange={e => setSubForm(p => ({ ...p, agentId: e.target.value }))}
                  >
                    <option value="">Select agent...</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.emoji || '🤖'} {a.name}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1 block">Topic</label>
                  <Input
                    placeholder="e.g., code-reviews"
                    value={subForm.topic}
                    onChange={e => setSubForm(p => ({ ...p, topic: e.target.value }))}
                  />
                </div>
                <Button size="sm" onClick={handleSubscribe} disabled={!subForm.agentId || !subForm.topic}>
                  <Bell className="h-4 w-4 mr-1.5" />
                  Subscribe
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Subscription list grouped by agent */}
          {subscriptions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No subscriptions yet</p>
                <p className="text-xs mt-1">Subscribe agents to topics to receive pub/sub messages</p>
              </CardContent>
            </Card>
          ) : (
            (() => {
              // Group subscriptions by agent
              const grouped = new Map<string, Subscription[]>()
              for (const s of subscriptions) {
                const list = grouped.get(s.agentId) || []
                list.push(s)
                grouped.set(s.agentId, list)
              }
              return (
                <div className="grid gap-3">
                  {Array.from(grouped.entries()).map(([agentId, subs]) => (
                    <Card key={agentId}>
                      <CardContent className="py-4 px-5">
                        <h4 className="text-sm font-medium mb-3">{agentName(agentId, agents)}</h4>
                        <div className="flex flex-wrap gap-2">
                          {subs.map(s => (
                            <Badge
                              key={`${s.agentId}-${s.topic}`}
                              variant="secondary"
                              className="text-xs pl-2 pr-1 py-1 flex items-center gap-1.5"
                            >
                              <Hash className="h-3 w-3" />
                              {s.topic}
                              <button
                                className="ml-1 rounded-sm hover:bg-destructive/20 p-0.5"
                                onClick={() => handleUnsubscribe(s.agentId, s.topic)}
                                title="Unsubscribe"
                              >
                                <BellOff className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )
            })()
          )}
        </div>
      )}
    </div>
  )
}
