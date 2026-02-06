import { useState } from 'react'
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
import {
  RefreshCw,
  BookOpen,
  CheckCircle2,
  Clock,
  Ban,
  Plus,
  ThumbsUp,
  ThumbsDown,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle,
  FileText,
  X,
  UserPlus,
  UserMinus,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Skill {
  name: string
  description?: string
  status: 'active' | 'pending' | 'disabled'
  content?: string
  requestedBy?: string
  requested_by?: string
  assignedAgents?: string[]
  assigned_agents?: string[]
}

interface SkillDetail {
  name: string
  status: string
  content: string
  description?: string
  path?: string
}

interface Agent {
  id: string
  name: string
  emoji?: string
}

interface SkillsPageProps {
  skills: Skill[]
  agents: Agent[]
  onRefresh: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillsPage({ skills, agents, onRefresh }: SkillsPageProps) {
  const [skillName, setSkillName] = useState('')
  const [skillDescription, setSkillDescription] = useState('')
  const [skillContent, setSkillContent] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installStatus, setInstallStatus] = useState<{
    type: 'success' | 'error' | null
    message: string
  }>({ type: null, message: '' })

  // Skill detail modal state
  const [selectedSkill, setSelectedSkill] = useState<{ name: string; status: string } | null>(null)
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Agent assignment state
  const [assigningSkill, setAssigningSkill] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState('')

  const openSkillDetail = async (name: string, status: string) => {
    setSelectedSkill({ name, status })
    setLoadingDetail(true)
    try {
      const detail = await api<SkillDetail>(`/skills/${status}/${encodeURIComponent(name)}`)
      setSkillDetail(detail)
    } catch (e: any) {
      console.error('Failed to load skill detail:', e.message)
      setSkillDetail(null)
    }
    setLoadingDetail(false)
  }

  const closeSkillDetail = () => {
    setSelectedSkill(null)
    setSkillDetail(null)
  }

  const active = skills.filter((s) => s.status === 'active')
  const pending = skills.filter((s) => s.status === 'pending')
  const disabled = skills.filter((s) => s.status === 'disabled')

  const approve = async (name: string) => {
    try {
      await api('/skills/' + encodeURIComponent(name) + '/approve', { method: 'POST' })
      onRefresh()
    } catch (e: any) {
      console.error('Approve failed:', e.message)
    }
  }

  const reject = async (name: string) => {
    try {
      await api('/skills/' + encodeURIComponent(name) + '/reject', { method: 'POST' })
      onRefresh()
    } catch (e: any) {
      console.error('Reject failed:', e.message)
    }
  }

  const remove = async (name: string) => {
    try {
      await api('/skills/' + encodeURIComponent(name), { method: 'DELETE' })
      onRefresh()
    } catch (e: any) {
      console.error('Remove failed:', e.message)
    }
  }

  const install = async () => {
    if (!skillName.trim()) return
    setInstalling(true)
    setInstallStatus({ type: null, message: '' })
    try {
      const result = await api<{ success?: boolean; message?: string; error?: string }>(
        '/skills/install',
        {
          method: 'POST',
          body: {
            name: skillName.trim(),
            description: skillDescription.trim() || undefined,
            content: skillContent.trim() || undefined,
          },
        }
      )
      if (result.success) {
        setInstallStatus({ type: 'success', message: result.message || 'Skill created successfully' })
        setSkillName('')
        setSkillDescription('')
        setSkillContent('')
        onRefresh()
        setTimeout(() => setInstallStatus({ type: null, message: '' }), 5000)
      } else {
        setInstallStatus({ type: 'error', message: result.error || 'Creation failed' })
      }
    } catch (e: any) {
      setInstallStatus({ type: 'error', message: e.message || 'Creation failed' })
    }
    setInstalling(false)
  }

  const assignToAgent = async (skillName: string, agentId: string) => {
    try {
      await api('/skills/' + encodeURIComponent(skillName) + '/assign', {
        method: 'POST',
        body: { agentId },
      })
      setAssigningSkill(null)
      setSelectedAgentId('')
      onRefresh()
    } catch (e: any) {
      console.error('Assign failed:', e.message)
    }
  }

  const unassignFromAgent = async (skillName: string, agentId: string) => {
    try {
      await api('/skills/' + encodeURIComponent(skillName) + '/unassign', {
        method: 'POST',
        body: { agentId },
      })
      onRefresh()
    } catch (e: any) {
      console.error('Unassign failed:', e.message)
    }
  }

  const getAssignedAgents = (skill: Skill): string[] => {
    return skill.assignedAgents || skill.assigned_agents || []
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Skills</h2>
        <Button variant="secondary" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Pending approval */}
      {pending.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[hsl(var(--warning))]">
            <Clock className="h-4 w-4" />
            Pending Approval ({pending.length})
          </h3>
          <div className="space-y-2">
            {pending.map((s) => (
              <Card
                key={s.name}
                className="border-[hsl(var(--warning))]/30"
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="min-w-0">
                    <button
                      onClick={() => openSkillDetail(s.name, 'pending')}
                      className="text-sm font-medium text-foreground hover:text-primary hover:underline text-left"
                    >
                      {s.name}
                    </button>
                    {s.description && (
                      <div className="text-xs mt-0.5 truncate text-muted-foreground">
                        {s.description}
                      </div>
                    )}
                    {(s.requestedBy || s.requested_by) && (
                      <div className="text-xs mt-0.5 text-muted-foreground/60">
                        Requested by: {s.requestedBy || s.requested_by}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0 ml-4">
                    <Button size="sm" onClick={() => approve(s.name)}>
                      <ThumbsUp className="h-3.5 w-3.5 mr-1.5" />
                      Approve
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => reject(s.name)}
                    >
                      <ThumbsDown className="h-3.5 w-3.5 mr-1.5" />
                      Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Active skills */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[hsl(var(--success))]">
          <CheckCircle2 className="h-4 w-4" />
          Active Skills ({active.length})
        </h3>
        {active.length === 0 ? (
          <Card className="border-[hsl(var(--success))]/20">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">
                No active skills installed.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {active.map((s) => {
              const assigned = getAssignedAgents(s)
              return (
                <Card
                  key={s.name}
                  className="border-[hsl(var(--success))]/30"
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <button
                          onClick={() => openSkillDetail(s.name, 'active')}
                          className="text-sm font-medium text-foreground hover:text-primary hover:underline text-left"
                        >
                          {s.name}
                        </button>
                        {s.description && (
                          <div className="text-xs mt-0.5 truncate text-muted-foreground">
                            {s.description}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0 ml-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setAssigningSkill(assigningSkill === s.name ? null : s.name)
                            setSelectedAgentId('')
                          }}
                        >
                          <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                          Assign
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => remove(s.name)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                          Remove
                        </Button>
                      </div>
                    </div>

                    {/* Assigned agents */}
                    {assigned.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {assigned.map((agentId) => {
                          const agent = agents.find((a) => a.id === agentId)
                          return (
                            <Badge
                              key={agentId}
                              variant="secondary"
                              className="flex items-center gap-1 pr-1"
                            >
                              <span>{agent?.emoji || '🤖'}</span>
                              <span>{agent?.name || agentId}</span>
                              <button
                                onClick={() => unassignFromAgent(s.name, agentId)}
                                className="ml-0.5 hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          )
                        })}
                      </div>
                    )}

                    {/* Agent assignment dropdown */}
                    {assigningSkill === s.name && (
                      <div className="flex gap-2 mt-3 pt-3 border-t">
                        <select
                          value={selectedAgentId}
                          onChange={(e) => setSelectedAgentId(e.target.value)}
                          className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="">Select an agent...</option>
                          {agents
                            .filter((a) => !assigned.includes(a.id))
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.emoji || '🤖'} {a.name}
                              </option>
                            ))}
                        </select>
                        <Button
                          size="sm"
                          disabled={!selectedAgentId}
                          onClick={() => assignToAgent(s.name, selectedAgentId)}
                        >
                          Assign
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Disabled skills */}
      {disabled.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground">
            <Ban className="h-4 w-4" />
            Disabled ({disabled.length})
          </h3>
          <div className="space-y-2">
            {disabled.map((s) => (
              <Card key={s.name}>
                <CardContent className="p-4 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{s.name}</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="shrink-0 ml-4"
                    onClick={() => remove(s.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Remove
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Empty state when there are no skills at all */}
      {skills.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BookOpen className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No skills</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Create skills with SKILL.md instruction files below
          </p>
        </div>
      )}

      {/* Create skill form */}
      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create Skill
          </h3>
          <div className="space-y-3">
            <Input
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
              placeholder="Skill name (e.g. code-review, deploy-helper)"
              disabled={installing}
            />
            <Input
              value={skillDescription}
              onChange={(e) => setSkillDescription(e.target.value)}
              placeholder="Description (optional)"
              disabled={installing}
            />
            <textarea
              value={skillContent}
              onChange={(e) => setSkillContent(e.target.value)}
              placeholder="SKILL.md content (markdown instructions, slash commands, project-specific knowledge)..."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[120px] font-mono"
              disabled={installing}
            />
            <Button onClick={install} disabled={installing || !skillName.trim()}>
              {installing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Create Skill
                </>
              )}
            </Button>
          </div>
          {installStatus.type && (
            <div
              className={`flex items-center gap-2 mt-3 text-sm ${
                installStatus.type === 'success'
                  ? 'text-[hsl(var(--success))]'
                  : 'text-[hsl(var(--destructive))]'
              }`}
            >
              {installStatus.type === 'success' ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              {installStatus.message}
            </div>
          )}
          <p className="text-xs mt-2 text-muted-foreground/60">
            Skills are SKILL.md instruction files that provide slash commands,
            project-specific knowledge, and agent instructions. New skills go to
            pending and require approval.
          </p>
        </CardContent>
      </Card>

      {/* Skill Detail Modal */}
      <Dialog open={!!selectedSkill} onOpenChange={(open) => !open && closeSkillDetail()}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              {selectedSkill?.name}
              <Badge variant={selectedSkill?.status === 'active' ? 'default' : 'secondary'}>
                {selectedSkill?.status}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {loadingDetail ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : skillDetail ? (
            <div className="flex-1 min-h-0">
              {skillDetail.description && (
                <p className="text-sm text-muted-foreground mb-3">
                  {skillDetail.description}
                </p>
              )}
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">SKILL.md</span>
              </div>
              <ScrollArea className="h-[400px] rounded border bg-muted/30">
                <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words">
                  {(skillDetail.contents?.['SKILL.md']) || skillDetail.content || '(empty)'}
                </pre>
              </ScrollArea>
              {skillDetail.path && (
                <div className="pt-4 border-t mt-4 text-xs text-muted-foreground">
                  Path: {skillDetail.path}
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              Failed to load skill details
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
