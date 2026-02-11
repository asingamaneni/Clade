import { useState, useEffect, useMemo, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  Plus,
  Bot,
  Trash2,
  Save,
  Loader2,
  Search,
  FileText,
  X,
  ArrowLeft,
  RefreshCw,
  Clock,
  Sparkles,
  ChevronRight,
  Eye,
  Wrench,
  BookOpen,
  Info,
} from "lucide-react"

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
  creature?: string
  vibe?: string
  avatar?: string
  customTools?: string[]
  mcp?: string[]
  skills?: string[]
  heartbeat?: {
    enabled?: boolean
    interval?: string
    activeHours?: { start?: string; end?: string }
  }
  admin?: {
    enabled?: boolean
    autoApproveSkills?: boolean
    canCreateSkills?: boolean
    canManageAgents?: boolean
  }
}

interface AgentsPageProps {
  agents: Agent[]
  onRefresh: () => void
  onNavigateToAgent?: (id: string) => void
  initialSelectedId?: string | null
  onAgentDeleted?: () => void
}

// ---------------------------------------------------------------------------
// Tool definitions & presets
// ---------------------------------------------------------------------------

interface ToolDef {
  id: string
  desc: string
}

interface ToolCategory {
  name: string
  label: string
  icon: string
  tools: ToolDef[]
}

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    name: 'Fs',
    label: 'File System',
    icon: '\uD83D\uDCC1',
    tools: [
      { id: 'Read', desc: 'Read files from the local filesystem' },
      { id: 'Edit', desc: 'Exact string replacements in files' },
      { id: 'Write', desc: 'Create or overwrite files on disk' },
      { id: 'Glob', desc: 'Fast glob-based file pattern matching' },
      { id: 'Grep', desc: 'Regex content search powered by ripgrep' },
      { id: 'NotebookEdit', desc: 'Edit Jupyter notebook cells' },
    ],
  },
  {
    name: 'Runtime',
    label: 'Runtime',
    icon: '\u2699\uFE0F',
    tools: [
      { id: 'Bash', desc: 'Execute shell commands with timeout' },
      { id: 'Task', desc: 'Spawn sub-agent tasks in parallel' },
      { id: 'TodoWrite', desc: 'Structured task list management' },
    ],
  },
  {
    name: 'Web',
    label: 'Web Access',
    icon: '\uD83C\uDF10',
    tools: [
      { id: 'WebFetch', desc: 'Fetch URLs and extract content via AI' },
      { id: 'WebSearch', desc: 'Search the web for current information' },
    ],
  },
  {
    name: 'Memory',
    label: 'Memory MCP',
    icon: '\uD83E\uDDE0',
    tools: [
      { id: 'mcp__memory__*', desc: 'Memory read, write, search, and list tools' },
    ],
  },
  {
    name: 'Sessions',
    label: 'Sessions MCP',
    icon: '\uD83D\uDCAC',
    tools: [
      { id: 'mcp__sessions__*', desc: 'Session spawn, list, send, and status tools' },
    ],
  },
  {
    name: 'Messaging',
    label: 'Messaging MCP',
    icon: '\uD83D\uDCE8',
    tools: [
      { id: 'mcp__messaging__*', desc: 'Cross-channel message sending tools' },
    ],
  },
  {
    name: 'McpManager',
    label: 'MCP Manager',
    icon: '\uD83E\uDDE9',
    tools: [
      { id: 'mcp__mcp-manager__*', desc: 'Dynamic MCP server search and installation' },
    ],
  },
  {
    name: 'Admin',
    label: 'Admin MCP',
    icon: '\uD83D\uDEE0\uFE0F',
    tools: [
      { id: 'mcp__admin__*', desc: 'Full MCP server/plugin management (orchestrator only)' },
    ],
  },
]

const ALL_TOOL_IDS = TOOL_CATEGORIES.flatMap((c) => c.tools.map((t) => t.id))

const PRESET_MAP: Record<string, string[]> = {
  potato: [],
  coding: [
    'Read',
    'Edit',
    'Write',
    'Bash',
    'Glob',
    'Grep',
    'NotebookEdit',
    'mcp__memory__*',
    'mcp__sessions__*',
  ],
  messaging: ['mcp__memory__*', 'mcp__sessions__*', 'mcp__messaging__*'],
  full: [...ALL_TOOL_IDS],
}

function detectPreset(tools: string[]): string {
  for (const [name, list] of Object.entries(PRESET_MAP)) {
    if (
      list.length === tools.length &&
      list.every((t) => tools.includes(t))
    ) {
      return name
    }
  }
  return 'custom'
}

// ---------------------------------------------------------------------------
// Sub: Soul Tab
// ---------------------------------------------------------------------------

function SoulTab({ agentId }: { agentId: string }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    api<{ content: string }>('/agents/' + agentId + '/soul')
      .then((d) => setContent(d.content || ''))
      .catch((e) => console.error('Failed to load SOUL.md:', e.message))
      .finally(() => setLoading(false))
  }, [agentId])

  const save = async () => {
    setSaving(true)
    try {
      await api('/agents/' + agentId + '/soul', {
        method: 'PUT',
        body: { content },
      })
      console.log('SOUL.md saved successfully')
    } catch (e: any) {
      console.error('Save failed:', e.message)
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading SOUL.md...</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="# SOUL.md - Who You Are..."
        spellCheck={false}
        className="font-mono text-[13px] leading-relaxed min-h-[420px] max-h-[70vh] resize-y"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground/60">
          {content.length} characters
        </span>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save SOUL.md
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub: Identity Tab
// ---------------------------------------------------------------------------

interface IdentityForm {
  name: string
  creature: string
  vibe: string
  emoji: string
  avatar: string
  model: string
  adminEnabled: boolean
}

function IdentityTab({ agentId }: { agentId: string }) {
  const [form, setForm] = useState<IdentityForm>({
    name: '',
    creature: '',
    vibe: '',
    emoji: '',
    avatar: '',
    model: 'sonnet',
    adminEnabled: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    api<{ agent: Record<string, any> }>('/agents/' + agentId)
      .then((d) => {
        const a = d.agent || {}
        setForm({
          name: a.name || '',
          creature: a.creature || '',
          vibe: a.vibe || '',
          emoji: a.emoji || '',
          avatar: a.avatar || '',
          model: a.model || 'sonnet',
          adminEnabled: a.admin?.enabled || false,
        })
      })
      .catch((e) => console.error('Failed to load identity:', e.message))
      .finally(() => setLoading(false))
  }, [agentId])

  const updateField = (key: keyof IdentityForm, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const { adminEnabled, ...rest } = form
      const body = { ...rest, admin: { enabled: adminEnabled } }
      await api('/agents/' + agentId, { method: 'PUT', body })
      console.log('Identity saved')
    } catch (e: any) {
      console.error('Save failed:', e.message)
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading identity...</span>
      </div>
    )
  }

  const fields: { key: keyof IdentityForm; label: string; placeholder: string }[] = [
    { key: 'name', label: 'Name', placeholder: 'e.g. Sparky' },
    { key: 'creature', label: 'Creature', placeholder: 'e.g. AI familiar, ghost in the machine' },
    { key: 'vibe', label: 'Vibe', placeholder: 'e.g. sharp, warm, chaotic' },
    { key: 'emoji', label: 'Emoji', placeholder: 'Pick one that feels right' },
    { key: 'avatar', label: 'Avatar', placeholder: 'URL or workspace-relative path' },
  ]

  return (
    <div className="max-w-lg space-y-4">
      {fields.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{f.label}</Label>
          <Input
            value={form[f.key] as string}
            onChange={(e) => updateField(f.key, e.target.value)}
            placeholder={f.placeholder}
          />
        </div>
      ))}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Model</Label>
        <Select value={form.model} onValueChange={(v) => updateField('model', v)}>
          <SelectTrigger>
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sonnet">Sonnet</SelectItem>
            <SelectItem value="opus">Opus</SelectItem>
            <SelectItem value="haiku">Haiku</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Separator className="my-4" />
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm flex items-center gap-1.5">
            <Wrench className="h-4 w-4" />
            Admin Privileges
          </Label>
          <p className="text-xs text-muted-foreground">
            Enable full MCP server and plugin management
          </p>
        </div>
        <Switch
          checked={form.adminEnabled}
          onCheckedChange={(checked) => updateField('adminEnabled', checked)}
        />
      </div>
      <div className="flex justify-end pt-4">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Identity
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub: Tools Tab
// ---------------------------------------------------------------------------

const PRESET_STYLES: Record<string, { label: string; className: string }> = {
  potato: {
    label: '\uD83E\uDD54 Potato',
    className:
      'bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30 hover:bg-[hsl(var(--warning))]/20',
  },
  coding: {
    label: '\uD83D\uDCBB Coding',
    className:
      'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20',
  },
  messaging: {
    label: '\uD83D\uDCE8 Messaging',
    className:
      'bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/30 hover:bg-[hsl(var(--success))]/20',
  },
  full: {
    label: '\uD83D\uDE80 Full',
    className:
      'bg-[hsl(var(--chart-purple))]/10 text-[hsl(var(--chart-purple))] border-[hsl(var(--chart-purple))]/30 hover:bg-[hsl(var(--chart-purple))]/20',
  },
}

function ToolsTab({
  agent,
  onRefresh,
}: {
  agent: Agent
  onRefresh: () => void
}) {
  const initial = useMemo(() => {
    if (agent.toolPreset === 'custom') return agent.customTools || []
    return PRESET_MAP[agent.toolPreset || 'full'] || PRESET_MAP.full
  }, [agent.id, agent.toolPreset, agent.customTools])

  const [enabled, setEnabled] = useState<string[]>([...initial])
  const [saving, setSaving] = useState(false)
  const preset = detectPreset(enabled)

  useEffect(() => {
    setEnabled([...initial])
  }, [initial])

  const toggle = (id: string) => {
    setEnabled((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    )
  }

  const applyPreset = (name: string) => setEnabled([...PRESET_MAP[name]])

  const save = async () => {
    setSaving(true)
    try {
      const p = detectPreset(enabled)
      const body =
        p !== 'custom'
          ? { toolPreset: p, customTools: [] }
          : { toolPreset: 'custom', customTools: enabled }
      await api('/agents/' + agent.id, { method: 'PUT', body })
      console.log('Tool configuration saved')
      onRefresh()
    } catch (e: any) {
      console.error('Save failed:', e.message)
    }
    setSaving(false)
  }

  const totalEnabled = enabled.length
  const totalTools = ALL_TOOL_IDS.length

  return (
    <div className="space-y-6">
      {/* Preset buttons */}
      <div className="flex items-center flex-wrap gap-2">
        {Object.entries(PRESET_STYLES).map(([key, style]) => (
          <button
            key={key}
            onClick={() => applyPreset(key)}
            className={cn(
              "px-4 py-1.5 rounded-full text-[13px] font-semibold border-2 transition-all",
              style.className,
              preset === key && "ring-1 ring-current",
            )}
          >
            {style.label}
          </button>
        ))}
        {preset === 'custom' && (
          <Badge variant="outline" className="font-mono text-xs">
            custom
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground/60">
          {totalEnabled}/{totalTools} tools enabled
        </span>
      </div>

      {/* Tool category sections */}
      {TOOL_CATEGORIES.filter((cat) => cat.name !== 'Admin' || agent.admin?.enabled).map((cat) => {
        const catEnabled = cat.tools.filter((t) =>
          enabled.includes(t.id),
        ).length
        const allEnabled = catEnabled === cat.tools.length
        return (
          <div key={cat.name}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">{cat.icon}</span>
              <h4 className="text-sm font-semibold text-foreground">
                {cat.label}
              </h4>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  allEnabled
                    ? "text-[hsl(var(--success))] border-[hsl(var(--success))]/30"
                    : catEnabled > 0
                      ? "text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30"
                      : "",
                )}
              >
                {catEnabled}/{cat.tools.length}
              </Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {cat.tools.map((tool) => {
                const on = enabled.includes(tool.id)
                return (
                  <Card
                    key={tool.id}
                    className={cn(
                      "transition-colors",
                      on
                        ? "border-[hsl(var(--success))]/40 hover:border-[hsl(var(--success))]/60"
                        : "hover:border-muted-foreground/30",
                    )}
                  >
                    <CardContent className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div
                          className={cn(
                            "text-[13px] font-medium truncate font-mono",
                            on ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {tool.id}
                        </div>
                        <div className="text-xs mt-0.5 truncate text-muted-foreground/60">
                          {tool.desc}
                        </div>
                      </div>
                      <Switch
                        checked={on}
                        onCheckedChange={() => toggle(tool.id)}
                      />
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Save bar */}
      <Separator />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground/60">
          Preset: <span className="text-muted-foreground">{preset}</span>
        </span>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Tool Config
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub: MCP Tab (per-agent MCP server assignment)
// ---------------------------------------------------------------------------

interface Skill {
  name: string
  status: 'active' | 'pending'
  description?: string
  path?: string
  builtin?: boolean
}

function McpTab({
  agent,
  onRefresh,
}: {
  agent: Agent
  onRefresh: () => void
}) {
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([])
  const [presets, setPresets] = useState<Record<string, string[]>>({})
  const [assignedSkills, setAssignedSkills] = useState<string[]>(agent.mcp || [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Fetch active MCP servers + preset mapping
  useEffect(() => {
    setLoading(true)
    api<{ mcpServers: Skill[]; presets?: Record<string, string[]> }>('/mcp')
      .then((d) => {
        const active = (d.mcpServers || []).filter((s) => s.status === 'active')
        setAvailableSkills(active)
        if (d.presets) setPresets(d.presets)
      })
      .catch((e) => console.error('Failed to load MCP servers:', e.message))
      .finally(() => setLoading(false))
  }, [])

  // Reset when agent changes
  useEffect(() => {
    setAssignedSkills(agent.mcp || [])
  }, [agent.id, agent.mcp])

  // Determine which built-in servers are active for this agent's preset
  const presetServers = presets[agent.toolPreset] || []

  const toggle = (skillName: string) => {
    setAssignedSkills((prev) =>
      prev.includes(skillName)
        ? prev.filter((s) => s !== skillName)
        : [...prev, skillName]
    )
  }

  const save = async () => {
    setSaving(true)
    try {
      await api('/agents/' + agent.id, {
        method: 'PUT',
        body: { mcp: assignedSkills },
      })
      console.log('MCP config saved')
      onRefresh()
    } catch (e: any) {
      console.error('Save failed:', e.message)
    }
    setSaving(false)
  }

  const hasChanges =
    JSON.stringify([...assignedSkills].sort()) !==
    JSON.stringify([...(agent.mcp || [])].sort())

  // Count: built-in preset servers + user-toggled extras
  const builtinCount = availableSkills.filter(
    (s) => s.builtin && presetServers.includes(s.name)
  ).length
  const userAssignedCount = assignedSkills.filter(
    (s) => !availableSkills.find((a) => a.name === s && a.builtin)
  ).length
  const totalEnabled = builtinCount + userAssignedCount
  const totalAvailable = availableSkills.length

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading MCP servers...
      </div>
    )
  }

  // Separate built-in vs user-installed
  const builtinServers = availableSkills.filter((s) => s.builtin)
  const userServers = availableSkills.filter((s) => !s.builtin)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Agent MCP Servers</h3>
          <p className="text-xs text-muted-foreground mt-1">
            MCP servers give this agent additional capabilities
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {totalEnabled}/{totalAvailable} enabled
        </Badge>
      </div>

      {/* Built-in MCP servers from preset */}
      {builtinServers.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Built-in ({agent.toolPreset} preset)
            </h4>
          </div>
          <div className="space-y-1.5">
            {builtinServers.map((skill) => {
              const isActive = presetServers.includes(skill.name)
              return (
                <div
                  key={skill.name}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg border transition-colors",
                    isActive
                      ? "border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5"
                      : "border-border opacity-50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "w-4 h-4 rounded border-2 flex items-center justify-center",
                        isActive
                          ? "bg-[hsl(var(--success))] border-[hsl(var(--success))]"
                          : "border-muted-foreground/30"
                      )}
                    >
                      {isActive && (
                        <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                          <path d="M10.28 2.28L3.989 8.575 1.695 6.28A1 1 0 00.28 7.695l3 3a1 1 0 001.414 0l7-7A1 1 0 0010.28 2.28z" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <div className="font-mono text-sm">{skill.name}</div>
                      {skill.description && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {skill.description}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      Built-in
                    </Badge>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* User-installed MCP servers (toggleable) */}
      {userServers.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Installed
          </h4>
          <div className="space-y-1.5">
            {userServers.map((skill) => {
              const isAssigned = assignedSkills.includes(skill.name)
              return (
                <div
                  key={skill.name}
                  onClick={() => toggle(skill.name)}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                    isAssigned
                      ? "border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5"
                      : "border-border hover:border-muted-foreground/30"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                        isAssigned
                          ? "bg-[hsl(var(--success))] border-[hsl(var(--success))]"
                          : "border-muted-foreground/30"
                      )}
                    >
                      {isAssigned && (
                        <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                          <path d="M10.28 2.28L3.989 8.575 1.695 6.28A1 1 0 00.28 7.695l3 3a1 1 0 001.414 0l7-7A1 1 0 0010.28 2.28z" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <div className="font-mono text-sm">{skill.name}</div>
                      {skill.description && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {skill.description}
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    Installed
                  </Badge>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {userServers.length === 0 && builtinServers.length > 0 && (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-xs text-muted-foreground">
            No additional MCP servers installed. Use the MCP Servers page to add more.
          </p>
        </div>
      )}

      {availableSkills.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No MCP servers available. Install MCP servers from the MCP Servers page.
          </p>
        </div>
      )}

      {userServers.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving || !hasChanges} size="sm">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5 mr-1.5" />
                Save MCP Config
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub: Skills Tab (per-agent skill assignment)
// ---------------------------------------------------------------------------

interface SkillInfo {
  name: string
  status: 'active' | 'pending' | 'disabled'
  description?: string
}

interface SkillDetailData {
  name: string
  status: string
  path?: string
  files?: string[]
  contents?: Record<string, string>
}

function SkillsTab({
  agent,
  onRefresh,
}: {
  agent: Agent
  onRefresh: () => void
}) {
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([])
  const [assignedSkills, setAssignedSkills] = useState<string[]>(agent.skills || [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedSkillDetail, setSelectedSkillDetail] = useState<SkillDetailData | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Fetch active skills
  useEffect(() => {
    setLoading(true)
    api<{ skills: SkillInfo[] }>('/skills')
      .then((d) => {
        const active = (d.skills || []).filter((s) => s.status === 'active')
        setAvailableSkills(active)
      })
      .catch((e) => console.error('Failed to load skills:', e.message))
      .finally(() => setLoading(false))
  }, [])

  // Reset when agent changes
  useEffect(() => {
    setAssignedSkills(agent.skills || [])
  }, [agent.id, agent.skills])

  const toggle = (skillName: string) => {
    setAssignedSkills((prev) =>
      prev.includes(skillName)
        ? prev.filter((s) => s !== skillName)
        : [...prev, skillName]
    )
  }

  const save = async () => {
    setSaving(true)
    try {
      await api('/agents/' + agent.id, {
        method: 'PUT',
        body: { skills: assignedSkills },
      })
      onRefresh()
    } catch (e: any) {
      console.error('Save failed:', e.message)
    }
    setSaving(false)
  }

  const viewSkillDetail = async (name: string) => {
    setLoadingDetail(true)
    setSelectedSkillDetail(null)
    try {
      const detail = await api<SkillDetailData>('/skills/active/' + encodeURIComponent(name))
      setSelectedSkillDetail(detail)
    } catch (e: any) {
      console.error('Failed to load skill detail:', e.message)
    }
    setLoadingDetail(false)
  }

  const hasChanges =
    JSON.stringify([...assignedSkills].sort()) !==
    JSON.stringify([...(agent.skills || [])].sort())

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading skills...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Agent Skills</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Skills are SKILL.md instruction files that provide slash commands and project-specific knowledge
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {assignedSkills.length}/{availableSkills.length} assigned
        </Badge>
      </div>

      {availableSkills.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <BookOpen className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            No active skills available. Create skills from the Skills page.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {availableSkills.map((skill) => {
            const isAssigned = assignedSkills.includes(skill.name)
            return (
              <div
                key={skill.name}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg border transition-colors",
                  isAssigned
                    ? "border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5"
                    : "border-border hover:border-muted-foreground/30"
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    onClick={() => toggle(skill.name)}
                    className={cn(
                      "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors cursor-pointer",
                      isAssigned
                        ? "bg-[hsl(var(--success))] border-[hsl(var(--success))]"
                        : "border-muted-foreground/30"
                    )}
                  >
                    {isAssigned && (
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                        <path d="M10.28 2.28L3.989 8.575 1.695 6.28A1 1 0 00.28 7.695l3 3a1 1 0 001.414 0l7-7A1 1 0 0010.28 2.28z" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <div className="font-mono text-sm">{skill.name}</div>
                    {skill.description && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {skill.description}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => viewSkillDetail(skill.name)}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <Badge variant="secondary" className="text-xs">
                    SKILL.md
                  </Badge>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !hasChanges} size="sm">
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Skills
            </>
          )}
        </Button>
      </div>

      {/* Skill detail dialog */}
      <Dialog open={!!selectedSkillDetail || loadingDetail} onOpenChange={(open) => { if (!open) { setSelectedSkillDetail(null) } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              {selectedSkillDetail?.name || 'Loading...'}
            </DialogTitle>
            <DialogDescription>
              SKILL.md content for this skill
            </DialogDescription>
          </DialogHeader>
          {loadingDetail ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading skill...</span>
            </div>
          ) : selectedSkillDetail?.contents ? (
            <div className="overflow-y-auto min-h-0 flex-1">
              {Object.entries(selectedSkillDetail.contents).map(([filename, content]) => (
                <div key={filename} className="mb-4">
                  <div className="text-xs font-mono text-muted-foreground mb-1">{filename}</div>
                  <pre className="text-sm font-mono whitespace-pre-wrap text-foreground p-4 bg-muted/30 rounded-md">
                    {content}
                  </pre>
                </div>
              ))}
              {selectedSkillDetail.path && (
                <div className="text-xs text-muted-foreground/60 mt-2">
                  Path: {selectedSkillDetail.path}
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

// ---------------------------------------------------------------------------
// Sub: Memory Tab
// ---------------------------------------------------------------------------

function MemoryTab({ agentId }: { agentId: string }) {
  const [files, setFiles] = useState<string[]>([])
  const [selFile, setSelFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[] | null>(null)

  useEffect(() => {
    setLoading(true)
    setSelFile(null)
    setContent('')
    setResults(null)
    api<{ files: string[] }>('/agents/' + agentId + '/memory')
      .then((d) => setFiles(d.files || []))
      .catch((e) => console.error('Failed to load memory:', e.message))
      .finally(() => setLoading(false))
  }, [agentId])

  const openFile = async (file: string) => {
    setSelFile(file)
    setLoadingFile(true)
    setResults(null)
    try {
      const seg =
        file === 'MEMORY.md'
          ? 'MEMORY.md'
          : encodeURIComponent(file.replace('memory/', ''))
      const d = await api<{ content: string }>(
        '/agents/' + agentId + '/memory/' + seg,
      )
      setContent(d.content || '')
    } catch (e: any) {
      console.error('Failed to load file:', e.message)
      setContent('')
    }
    setLoadingFile(false)
  }

  const search = async () => {
    if (!query.trim()) return
    try {
      const d = await api<{ results: any[] }>(
        '/agents/' + agentId + '/memory/search',
        { method: 'POST', body: { query } },
      )
      setResults(d.results || [])
      setSelFile(null)
    } catch (e: any) {
      console.error('Search failed:', e.message)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading memory files...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Search memory (FTS5)..."
          className="flex-1"
        />
        <Button variant="secondary" size="sm" onClick={search}>
          <Search className="h-3.5 w-3.5 mr-1.5" />
          Search
        </Button>
      </div>

      {results !== null ? (
        /* Search results view */
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </span>
            <button
              className="text-xs text-primary hover:underline"
              onClick={() => setResults(null)}
            >
              Clear results
            </button>
          </div>
          {results.length === 0 ? (
            <p className="text-sm py-4 text-muted-foreground">
              No matching entries found.
            </p>
          ) : (
            results.map((r, i) => (
              <Card key={i}>
                <CardContent className="p-3">
                  <div className="text-xs font-mono mb-1 text-primary">
                    {r.file || r.file_path || r.filename || 'memory'}
                  </div>
                  <div className="text-sm text-foreground whitespace-pre-wrap">
                    {r.snippet || r.chunk_text || r.content || JSON.stringify(r)}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : (
        /* File list + content viewer */
        <div className="flex gap-4 min-h-[300px]">
          <div className="w-[180px] shrink-0 space-y-0.5 overflow-y-auto">
            {files.length === 0 ? (
              <p className="text-sm py-2 text-muted-foreground">No files.</p>
            ) : (
              files.map((f) => (
                <button
                  key={f}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm truncate transition-colors flex items-center gap-1.5",
                    selFile === f
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-secondary",
                  )}
                  onClick={() => openFile(f)}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{f}</span>
                </button>
              ))
            )}
          </div>
          <div className="flex-1 min-w-0">
            {selFile ? (
              loadingFile ? (
                <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading file...</span>
                </div>
              ) : (
                <div>
                  <div className="text-xs font-mono mb-2 text-muted-foreground">
                    {selFile}
                  </div>
                  <pre className="p-4 rounded-md text-sm bg-background border text-foreground font-mono max-h-[450px] overflow-auto whitespace-pre-wrap">
                    {content}
                  </pre>
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground/60">
                Select a file to view its contents.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub: Heartbeat Tab
// ---------------------------------------------------------------------------

function HeartbeatTab({ agentId }: { agentId: string }) {
  const [content, setContent] = useState('')
  const [interval, setIntervalVal] = useState('30m')
  const [useCustom, setUseCustom] = useState(false)
  const [customMinutes, setCustomMinutes] = useState('')
  const [activeStart, setActiveStart] = useState('00:00')
  const [activeEnd, setActiveEnd] = useState('23:59')
  const [hbEnabled, setHbEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const PRESETS = ['5m', '15m', '30m', '1h', '4h', 'daily'] as const
  const PRESET_LABELS: Record<string, string> = {
    '5m': '5 min', '15m': '15 min', '30m': '30 min',
    '1h': '1 hr', '4h': '4 hr', 'daily': '24 hr',
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api<{ content: string }>('/agents/' + agentId + '/heartbeat').catch(
        () => ({ content: '' }),
      ),
      api<{ agent: Record<string, any> }>('/agents/' + agentId).catch(() => ({
        agent: {},
      })),
    ])
      .then(([hb, ag]) => {
        setContent(hb.content || '')
        const c = (ag as any).agent?.heartbeat || {}
        const savedInterval = c.interval || '30m'
        if ((PRESETS as readonly string[]).includes(savedInterval)) {
          setIntervalVal(savedInterval)
          setUseCustom(false)
        } else {
          setUseCustom(true)
          const mMatch = savedInterval.match(/^(\d+)m$/)
          const hMatch = savedInterval.match(/^(\d+)h$/)
          if (mMatch) setCustomMinutes(mMatch[1])
          else if (hMatch) setCustomMinutes(String(Number(hMatch[1]) * 60))
          else setCustomMinutes('30')
        }
        setActiveStart(c.activeHours?.start || '00:00')
        setActiveEnd(c.activeHours?.end || '23:59')
        setHbEnabled(!!c.enabled)
      })
      .finally(() => setLoading(false))
  }, [agentId])

  const getEffectiveInterval = () => {
    if (!useCustom) return interval
    const mins = parseInt(customMinutes, 10)
    if (!mins || mins < 1) return '30m'
    if (mins >= 60 && mins % 60 === 0) return (mins / 60) + 'h'
    return mins + 'm'
  }

  const save = async () => {
    setSaving(true)
    try {
      const effectiveInterval = getEffectiveInterval()
      await Promise.all([
        api('/agents/' + agentId + '/heartbeat', {
          method: 'PUT',
          body: { content },
        }),
        api('/agents/' + agentId, {
          method: 'PUT',
          body: {
            heartbeat: {
              enabled: hbEnabled,
              interval: effectiveInterval,
              activeHours: { start: activeStart, end: activeEnd },
            },
          },
        }),
      ])
      console.log('Heartbeat settings saved')
    } catch (e: any) {
      console.error('Save failed:', e.message)
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading heartbeat...</span>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-5">
      {/* Enable toggle */}
      <div className="flex items-center gap-3">
        <Switch
          checked={hbEnabled}
          onCheckedChange={(v) => setHbEnabled(v)}
        />
        <span
          className={cn(
            "text-sm font-medium",
            hbEnabled
              ? "text-[hsl(var(--success))]"
              : "text-muted-foreground",
          )}
        >
          Heartbeat {hbEnabled ? 'enabled' : 'disabled'}
        </span>
      </div>

      {/* Interval */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Interval</Label>
        <div className="flex flex-wrap gap-2 items-center">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { setUseCustom(false); setIntervalVal(p) }}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                !useCustom && interval === p
                  ? "bg-primary/10 text-primary border-primary/40"
                  : "bg-background text-muted-foreground border-border hover:border-muted-foreground/50",
              )}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setUseCustom(true); if (!customMinutes) setCustomMinutes('10') }}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
              useCustom
                ? "bg-primary/10 text-primary border-primary/40"
                : "bg-background text-muted-foreground border-border hover:border-muted-foreground/50",
            )}
          >
            Custom
          </button>
          {useCustom && (
            <div className="flex items-center gap-1.5 ml-1">
              <Input
                type="number"
                min={1}
                max={1440}
                value={customMinutes}
                onChange={(e) => setCustomMinutes(e.target.value)}
                className="w-20 h-8 text-xs"
                placeholder="10"
              />
              <span className="text-xs text-muted-foreground">minutes</span>
            </div>
          )}
        </div>
      </div>

      {/* Active hours */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Active From</Label>
          <Input
            type="time"
            value={activeStart}
            onChange={(e) => setActiveStart(e.target.value)}
            step={60}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Active Until</Label>
          <Input
            type="time"
            value={activeEnd}
            onChange={(e) => setActiveEnd(e.target.value)}
            step={60}
          />
        </div>
      </div>

      {/* HEARTBEAT.md editor */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">HEARTBEAT.md</Label>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="# Heartbeat Checklist..."
          spellCheck={false}
          className="font-mono text-[13px] leading-relaxed min-h-[260px] resize-y"
        />
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Heartbeat
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub: TOOLS.md Tab
// ---------------------------------------------------------------------------

interface ToolsMdVersionEntry {
  date: string
  summary: string
}

function ToolsMdTab({ agentId }: { agentId: string }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<ToolsMdVersionEntry[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedContent, setSelectedContent] = useState<string | null>(null)
  const [loadingEntry, setLoadingEntry] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [toolsRes, historyRes] = await Promise.all([
        api<{ content: string }>('/agents/' + agentId + '/tools-md'),
        api<{ entries: ToolsMdVersionEntry[] }>('/agents/' + agentId + '/tools-md/history'),
      ])
      setContent(toolsRes.content || '')
      setHistory(historyRes.entries || [])
    } catch (e: any) {
      console.error('Failed to load TOOLS.md:', e.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [agentId])

  const save = async () => {
    setSaving(true)
    try {
      await api('/agents/' + agentId + '/tools-md', {
        method: 'PUT',
        body: { content },
      })
      console.log('TOOLS.md saved successfully')
      // Reload history after save
      const historyRes = await api<{ entries: ToolsMdVersionEntry[] }>(
        '/agents/' + agentId + '/tools-md/history'
      )
      setHistory(historyRes.entries || [])
    } catch (e: any) {
      console.error('Save failed:', e.message)
    }
    setSaving(false)
  }

  const viewHistoryEntry = async (date: string) => {
    setSelectedDate(date)
    setSelectedContent(null)
    setLoadingEntry(true)
    try {
      const res = await api<{ content: string }>(
        '/agents/' + agentId + '/tools-md/history/' + date
      )
      setSelectedContent(res.content)
    } catch (e: any) {
      setSelectedContent('Error loading entry: ' + e.message)
    }
    setLoadingEntry(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading TOOLS.md...</span>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Editor */}
      <div className="lg:col-span-2 space-y-3">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="# TOOLS.md — Workspace Context..."
          spellCheck={false}
          className="font-mono text-[13px] leading-relaxed min-h-[420px] max-h-[70vh] resize-y"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground/60">
            {content.length} characters
          </span>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5 mr-1.5" />
                Save TOOLS.md
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Version History */}
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Version History
          {history.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              ({history.length} snapshot{history.length !== 1 ? 's' : ''})
            </span>
          )}
        </h4>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No version history yet. Versions are saved when TOOLS.md is updated.
          </p>
        ) : (
          <ScrollArea className="max-h-[360px]">
            <div className="space-y-1.5 pr-3">
              {history.map((entry) => (
                <button
                  key={entry.date}
                  onClick={() => viewHistoryEntry(entry.date)}
                  className="w-full text-left group"
                >
                  <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
                    <CardContent className="p-3 flex items-center gap-3">
                      <Eye className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
                      <div className="text-xs font-mono text-primary whitespace-nowrap">
                        {entry.date}
                      </div>
                      <div className="text-sm text-muted-foreground truncate flex-1">
                        {entry.summary || '(snapshot)'}
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0" />
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* History entry viewer dialog */}
      <Dialog open={selectedDate !== null} onOpenChange={(open) => { if (!open) setSelectedDate(null) }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              TOOLS.md snapshot — {selectedDate}
            </DialogTitle>
            <DialogDescription>
              This is a snapshot of this agent's TOOLS.md from {selectedDate}.
            </DialogDescription>
          </DialogHeader>
          {loadingEntry ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading snapshot...</span>
            </div>
          ) : (
            <div className="overflow-y-auto min-h-0 flex-1">
              <pre className="text-sm font-mono whitespace-pre-wrap text-foreground p-4 bg-muted/30 rounded-md">
                {selectedContent}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub: USER.md Tab (global, shared across all agents)
// ---------------------------------------------------------------------------

interface UserMdVersionEntry {
  date: string
  summary: string
}

function UserMdTab() {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<UserMdVersionEntry[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedContent, setSelectedContent] = useState<string | null>(null)
  const [loadingEntry, setLoadingEntry] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [userRes, historyRes] = await Promise.all([
        api<{ content: string }>('/user'),
        api<{ entries: UserMdVersionEntry[] }>('/user/history'),
      ])
      setContent(userRes.content || '')
      setHistory(historyRes.entries || [])
    } catch (e: any) {
      console.error('Failed to load USER.md:', e.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await api('/user', {
        method: 'PUT',
        body: { content },
      })
      console.log('USER.md saved successfully')
      const historyRes = await api<{ entries: UserMdVersionEntry[] }>('/user/history')
      setHistory(historyRes.entries || [])
    } catch (e: any) {
      console.error('Save failed:', e.message)
    }
    setSaving(false)
  }

  const viewHistoryEntry = async (date: string) => {
    setSelectedDate(date)
    setSelectedContent(null)
    setLoadingEntry(true)
    try {
      const res = await api<{ content: string }>('/user/history/' + date)
      setSelectedContent(res.content)
    } catch (e: any) {
      setSelectedContent('Error loading entry: ' + e.message)
    }
    setLoadingEntry(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading USER.md...</span>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Editor */}
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="secondary" className="text-xs gap-1">
            <Info className="h-3 w-3" />
            Global — shared across all agents
          </Badge>
        </div>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="# USER.md — User-level instructions..."
          spellCheck={false}
          className="font-mono text-[13px] leading-relaxed min-h-[420px] max-h-[70vh] resize-y"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground/60">
            {content.length} characters
          </span>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5 mr-1.5" />
                Save USER.md
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Version History */}
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Version History
          {history.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              ({history.length} snapshot{history.length !== 1 ? 's' : ''})
            </span>
          )}
        </h4>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No version history yet. Versions are saved when USER.md is updated.
          </p>
        ) : (
          <ScrollArea className="max-h-[360px]">
            <div className="space-y-1.5 pr-3">
              {history.map((entry) => (
                <button
                  key={entry.date}
                  onClick={() => viewHistoryEntry(entry.date)}
                  className="w-full text-left group"
                >
                  <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
                    <CardContent className="p-3 flex items-center gap-3">
                      <Eye className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
                      <div className="text-xs font-mono text-primary whitespace-nowrap">
                        {entry.date}
                      </div>
                      <div className="text-sm text-muted-foreground truncate flex-1">
                        {entry.summary || '(snapshot)'}
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0" />
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* History entry viewer dialog */}
      <Dialog open={selectedDate !== null} onOpenChange={(open) => { if (!open) setSelectedDate(null) }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              USER.md snapshot — {selectedDate}
            </DialogTitle>
            <DialogDescription>
              This is a snapshot of the global USER.md from {selectedDate}.
            </DialogDescription>
          </DialogHeader>
          {loadingEntry ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading snapshot...</span>
            </div>
          ) : (
            <div className="overflow-y-auto min-h-0 flex-1">
              <pre className="text-sm font-mono whitespace-pre-wrap text-foreground p-4 bg-muted/30 rounded-md">
                {selectedContent}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub: Reflection Tab
// ---------------------------------------------------------------------------

interface ReflectionStatus {
  sessionsSinceReflection: number
  lastReflection: string
  reflectionInterval: number
  enabled: boolean
}

interface ReflectionHistoryEntry {
  date: string
  summary: string
}

function ReflectionTab({ agentId }: { agentId: string }) {
  const [status, setStatus] = useState<ReflectionStatus | null>(null)
  const [history, setHistory] = useState<ReflectionHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedContent, setSelectedContent] = useState<string | null>(null)
  const [loadingEntry, setLoadingEntry] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [statusRes, historyRes] = await Promise.all([
        api<ReflectionStatus & { agentId: string }>(
          '/agents/' + agentId + '/reflection',
        ),
        api<{ entries: ReflectionHistoryEntry[] }>(
          '/agents/' + agentId + '/reflection/history',
        ),
      ])
      setStatus(statusRes)
      setHistory(historyRes.entries || [])
    } catch (e: any) {
      console.error('Failed to load reflection data:', e.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [agentId])

  const viewHistoryEntry = async (date: string) => {
    setSelectedDate(date)
    setSelectedContent(null)
    setLoadingEntry(true)
    try {
      const res = await api<{ content: string }>(
        '/agents/' + agentId + '/reflection/history/' + date,
      )
      setSelectedContent(res.content)
    } catch (e: any) {
      setSelectedContent('Error loading entry: ' + e.message)
    }
    setLoadingEntry(false)
  }

  const triggerReflection = async () => {
    setRunning(true)
    setLastResult(null)
    try {
      const res = await api<{ triggered: boolean; result: { applied: boolean; diff: string } | null }>(
        '/agents/' + agentId + '/reflection',
        { method: 'POST' },
      )
      setLastResult(
        res.result
          ? res.result.diff
          : 'Reflection completed but no changes were made.',
      )
      // Reload data to reflect updated status
      await loadData()
    } catch (e: any) {
      setLastResult('Error: ' + e.message)
    }
    setRunning(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading reflection data...</span>
      </div>
    )
  }

  const lastDate = status?.lastReflection
    ? new Date(status.lastReflection)
    : null
  const neverReflected =
    !lastDate || lastDate.getTime() <= 0

  return (
    <div className="max-w-2xl space-y-6">
      {/* Status cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-foreground">
              {status?.sessionsSinceReflection ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Sessions since last
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-foreground">
              {status?.reflectionInterval ?? 10}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Interval (sessions)
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-sm font-medium text-foreground truncate">
              {neverReflected
                ? 'Never'
                : lastDate!.toLocaleDateString()}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Last reflection
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                status?.enabled
                  ? "text-[hsl(var(--success))] border-[hsl(var(--success))]/30"
                  : "text-muted-foreground",
              )}
            >
              {status?.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            <div className="text-xs text-muted-foreground mt-1.5">
              Status
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Manual trigger */}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={triggerReflection}
          disabled={running}
        >
          {running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Reflecting...
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Run Reflection Now
            </>
          )}
        </Button>
        <span className="text-xs text-muted-foreground">
          Manually triggers a reflection cycle regardless of session count.
        </span>
      </div>

      {/* Last result */}
      {lastResult && (
        <Card
          className={cn(
            "border",
            lastResult.startsWith('Error')
              ? "border-destructive/30 bg-destructive/5"
              : "border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5",
          )}
        >
          <CardContent className="p-3">
            <div className="text-xs font-semibold text-muted-foreground mb-1">
              Result
            </div>
            <div className="text-sm text-foreground">{lastResult}</div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* History */}
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Soul History
          {history.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              ({history.length} snapshot{history.length !== 1 ? 's' : ''})
            </span>
          )}
        </h4>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No reflection history yet. Reflections create snapshots of
            SOUL.md in soul-history/.
          </p>
        ) : (
          <ScrollArea className="max-h-[360px]">
            <div className="space-y-1.5 pr-3">
              {history.map((entry) => (
                <button
                  key={entry.date}
                  onClick={() => viewHistoryEntry(entry.date)}
                  className="w-full text-left group"
                >
                  <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
                    <CardContent className="p-3 flex items-center gap-3">
                      <Eye className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
                      <div className="text-xs font-mono text-primary whitespace-nowrap">
                        {entry.date}
                      </div>
                      <div className="text-sm text-muted-foreground truncate flex-1">
                        {entry.summary || '(empty snapshot)'}
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0" />
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* History entry viewer dialog */}
      <Dialog open={selectedDate !== null} onOpenChange={(open) => { if (!open) setSelectedDate(null) }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              SOUL.md snapshot — {selectedDate}
            </DialogTitle>
            <DialogDescription>
              This is a snapshot of the agent's SOUL.md before the reflection on {selectedDate}.
            </DialogDescription>
          </DialogHeader>
          {loadingEntry ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading snapshot...</span>
            </div>
          ) : (
            <div className="overflow-y-auto min-h-0 flex-1">
              <pre className="text-sm font-mono whitespace-pre-wrap text-foreground p-4 bg-muted/30 rounded-md">
                {selectedContent}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub: Agent Detail
// ---------------------------------------------------------------------------

function AgentDetail({
  agent,
  onRefresh,
  onDeleted,
}: {
  agent: Agent
  onRefresh: () => void
  onDeleted?: () => void
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api('/agents/' + agent.id, { method: 'DELETE' })
      console.log('Agent "' + agent.id + '" deleted')
      setShowDeleteConfirm(false)
      onDeleted?.()
    } catch (e: any) {
      console.error('Delete failed:', e.message)
    }
    setDeleting(false)
  }

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center rounded-full w-10 h-10 bg-secondary text-xl">
            {agent.emoji || '\uD83E\uDD16'}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {agent.name}
            </h2>
            <div className="text-xs text-muted-foreground">
              {agent.id} {'\u00B7'} {agent.model || 'sonnet'} {'\u00B7'}{' '}
              {agent.toolPreset}
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-destructive/30 hover:bg-destructive/10"
          onClick={() => setShowDeleteConfirm(true)}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          Delete Agent
        </Button>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{agent.name}"?</DialogTitle>
            <DialogDescription>
              This will remove the agent from config. Agent files in
              ~/.clade/agents/{agent.id}/ will remain on disk.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Yes, delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tabs */}
      <Tabs defaultValue="soul">
        <TabsList>
          <TabsTrigger value="soul">Soul</TabsTrigger>
          <TabsTrigger value="identity">Identity</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="tools-md">TOOLS.md</TabsTrigger>
          <TabsTrigger value="user-md">USER.md</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="heartbeat">Heartbeat</TabsTrigger>
          <TabsTrigger value="reflection">Reflection</TabsTrigger>
        </TabsList>
        <TabsContent value="soul">
          <SoulTab agentId={agent.id} />
        </TabsContent>
        <TabsContent value="identity">
          <IdentityTab agentId={agent.id} />
        </TabsContent>
        <TabsContent value="tools">
          <ToolsTab agent={agent} onRefresh={onRefresh} />
        </TabsContent>
        <TabsContent value="mcp">
          <McpTab agent={agent} onRefresh={onRefresh} />
        </TabsContent>
        <TabsContent value="skills">
          <SkillsTab agent={agent} onRefresh={onRefresh} />
        </TabsContent>
        <TabsContent value="tools-md">
          <ToolsMdTab agentId={agent.id} />
        </TabsContent>
        <TabsContent value="user-md">
          <UserMdTab />
        </TabsContent>
        <TabsContent value="memory">
          <MemoryTab agentId={agent.id} />
        </TabsContent>
        <TabsContent value="heartbeat">
          <HeartbeatTab agentId={agent.id} />
        </TabsContent>
        <TabsContent value="reflection">
          <ReflectionTab agentId={agent.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main: Agents Page
// ---------------------------------------------------------------------------

export function AgentsPage({
  agents,
  onRefresh,
  onNavigateToAgent,
  initialSelectedId,
  onAgentDeleted,
}: AgentsPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId || null,
  )
  const [showCreate, setShowCreate] = useState(false)

  // Sync external navigation
  useEffect(() => {
    if (initialSelectedId && agents.find((a) => a.id === initialSelectedId)) {
      setSelectedId(initialSelectedId)
    }
  }, [initialSelectedId, agents])

  // Auto-select first agent if none selected
  useEffect(() => {
    if (
      agents.length > 0 &&
      (!selectedId || !agents.find((a) => a.id === selectedId))
    ) {
      setSelectedId(agents[0].id)
    }
  }, [agents])

  const selectedAgent = agents.find((a) => a.id === selectedId) || null

  if (showCreate) {
    // Import WelcomePage dynamically to avoid circular deps
    // For now just toggle back -- in production this would show the welcome/create flow
    return (
      <div className="p-6">
        <Button
          variant="outline"
          size="sm"
          className="mb-4"
          onClick={() => setShowCreate(false)}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back to Agents
        </Button>
        <WelcomeInline
          onCreated={() => {
            setShowCreate(false)
            onRefresh()
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full -m-6">
      {/* Agent sub-sidebar */}
      <div className="flex flex-col py-3 w-[200px] min-w-[200px] border-r bg-secondary/30">
        <div className="flex items-center justify-between px-3 pb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Agents
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs text-[hsl(var(--success))] border-[hsl(var(--success))]/30 hover:bg-[hsl(var(--success))]/10"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            New
          </Button>
        </div>
        <ScrollArea className="flex-1">
          {agents.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              No agents
            </div>
          ) : (
            agents.map((a) => (
              <button
                key={a.id}
                className={cn(
                  "flex items-center gap-2 w-[calc(100%-16px)] mx-2 px-3 py-2.5 rounded-md text-sm transition-colors text-left",
                  selectedId === a.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary",
                )}
                onClick={() => setSelectedId(a.id)}
              >
                <span className="shrink-0">{a.emoji || '\uD83E\uDD16'}</span>
                <span className="truncate flex-1">{a.name || a.id}</span>
                {a.mcp && a.mcp.length > 0 && (
                  <span className="text-xs opacity-60">
                    {a.mcp.length}mcp
                  </span>
                )}
              </button>
            ))
          )}
        </ScrollArea>
      </div>

      {/* Agent detail panel */}
      <div className="flex-1 overflow-y-auto">
        {selectedAgent ? (
          <AgentDetail
            agent={selectedAgent}
            onRefresh={onRefresh}
            onDeleted={onAgentDeleted}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              Select an agent
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Choose from the list to view details
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline Welcome (for creating agents from agents page)
// ---------------------------------------------------------------------------

const TEMPLATES = [
  { id: 'orchestrator', name: 'Personal Assistant', desc: 'General-purpose, delegates to specialists', icon: '\uD83E\uDDE0' },
  { id: 'coding', name: 'Coding Partner', desc: 'Writes, reviews, and maintains code', icon: '\uD83D\uDCBB' },
  { id: 'research', name: 'Research Analyst', desc: 'Gathers and synthesizes information', icon: '\uD83D\uDD0D' },
  { id: 'ops', name: 'Ops Monitor', desc: 'Monitors systems and handles incidents', icon: '\uD83D\uDCE1' },
  { id: 'pm', name: 'Project Manager', desc: 'Tracks tasks and coordinates work', icon: '\uD83D\uDCCB' },
  { id: 'custom', name: 'Custom Agent', desc: 'Build from scratch with full control', icon: '\uD83D\uDD27' },
] as const

function WelcomeInline({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('orchestrator')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [agentDescription, setAgentDescription] = useState('')
  const [toolPreset, setToolPreset] = useState('full')
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true)
  const [heartbeatInterval, setHeartbeatInterval] = useState('30m')
  const [soulContent, setSoulContent] = useState('')

  const nameSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  const create = async () => {
    if (!nameSlug) {
      setError('Name is required')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { name: nameSlug, template }
      if (template === 'custom') {
        if (agentDescription) body.description = agentDescription
        body.toolPreset = toolPreset
        body.heartbeat = { enabled: heartbeatEnabled, interval: heartbeatInterval }
        if (soulContent) body.soulContent = soulContent
      }
      await api('/agents', { method: 'POST', body })
      onCreated()
    } catch (e: any) {
      setError(e.message)
    }
    setCreating(false)
  }

  return (
    <Card className="max-w-xl">
      <CardContent className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">
          Create New Agent
        </h3>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Agent Name</Label>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="e.g. jarvis, scout, atlas"
          />
          {nameSlug && nameSlug !== name && (
            <p className="text-xs text-muted-foreground/60">
              Will be created as:{' '}
              <code className="text-primary font-mono">{nameSlug}</code>
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Template</Label>
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map(t => (
              <button
                key={t.id}
                onClick={() => setTemplate(t.id)}
                className={cn(
                  "text-left p-3 rounded-lg border-2 transition-all",
                  template === t.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/40"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span>{t.icon}</span>
                  <span className="text-sm font-medium text-foreground">{t.name}</span>
                </div>
                <p className="text-xs text-muted-foreground">{t.desc}</p>
              </button>
            ))}
          </div>
        </div>
        {template === 'custom' && (
          <div className="space-y-3 p-3 rounded-lg border border-dashed bg-muted/20">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Description</Label>
              <Input
                value={agentDescription}
                onChange={(e) => setAgentDescription(e.target.value)}
                placeholder="What should this agent do?"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tool Preset</Label>
              <select
                value={toolPreset}
                onChange={(e) => setToolPreset(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="full">Full (all tools)</option>
                <option value="coding">Coding (file + shell)</option>
                <option value="messaging">Messaging (comms only)</option>
                <option value="potato">Potato (no tools)</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs">Heartbeat</Label>
                <p className="text-[11px] text-muted-foreground">Periodic check-ins</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={heartbeatInterval}
                  onChange={(e) => setHeartbeatInterval(e.target.value)}
                  disabled={!heartbeatEnabled}
                  className="h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground disabled:opacity-50"
                >
                  <option value="15m">15m</option>
                  <option value="30m">30m</option>
                  <option value="1h">1h</option>
                  <option value="4h">4h</option>
                </select>
                <Switch
                  checked={heartbeatEnabled}
                  onCheckedChange={setHeartbeatEnabled}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">SOUL.md (optional)</Label>
              <Textarea
                value={soulContent}
                onChange={(e) => setSoulContent(e.target.value)}
                placeholder="Custom personality and instructions..."
                className="font-mono text-xs min-h-[80px] resize-y"
              />
            </div>
          </div>
        )}
        {error && (
          <div className="p-3 rounded-md text-sm bg-destructive/10 border border-destructive/30 text-destructive">
            {error}
          </div>
        )}
        <Button
          className="w-full"
          onClick={create}
          disabled={creating || !nameSlug}
        >
          {creating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            'Create Agent'
          )}
        </Button>
      </CardContent>
    </Card>
  )
}

