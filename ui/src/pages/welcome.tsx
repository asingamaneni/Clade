import { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { ArrowLeft, Loader2, Sparkles, Wand2 } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Template {
  id: string
  name: string
  description: string
  toolPreset: string
  model: string
  heartbeat?: { interval?: string }
}

interface WelcomePageProps {
  onCreated: () => void
}

// ---------------------------------------------------------------------------
// Template metadata
// ---------------------------------------------------------------------------

interface TemplateMeta {
  icon: string
  colorClass: string
  borderClass: string
  bgClass: string
}

const TEMPLATE_META: Record<string, TemplateMeta> = {
  orchestrator: {
    icon: '\uD83D\uDD2E',
    colorClass: 'text-[#f0883e]',
    borderClass: 'border-[#f0883e]/40',
    bgClass: 'bg-[#f0883e]/5',
  },
  coding: {
    icon: '\uD83D\uDCBB',
    colorClass: 'text-[hsl(var(--chart-blue))]',
    borderClass: 'border-[hsl(var(--chart-blue))]/40',
    bgClass: 'bg-[hsl(var(--chart-blue))]/5',
  },
  research: {
    icon: '\uD83D\uDD0D',
    colorClass: 'text-[hsl(var(--chart-purple))]',
    borderClass: 'border-[hsl(var(--chart-purple))]/40',
    bgClass: 'bg-[hsl(var(--chart-purple))]/5',
  },
  ops: {
    icon: '\uD83D\uDCE1',
    colorClass: 'text-[hsl(var(--chart-green))]',
    borderClass: 'border-[hsl(var(--chart-green))]/40',
    bgClass: 'bg-[hsl(var(--chart-green))]/5',
  },
  pm: {
    icon: '\uD83D\uDCCB',
    colorClass: 'text-[hsl(var(--chart-yellow))]',
    borderClass: 'border-[hsl(var(--chart-yellow))]/40',
    bgClass: 'bg-[hsl(var(--chart-yellow))]/5',
  },
}

const DEFAULT_META: TemplateMeta = {
  icon: '\uD83E\uDD16',
  colorClass: 'text-muted-foreground',
  borderClass: 'border-border',
  bgClass: 'bg-secondary/50',
}

const FALLBACK_TEMPLATES: Template[] = [
  {
    id: 'coding',
    name: 'Coding Partner',
    description: 'Writes, reviews, and maintains code',
    toolPreset: 'coding',
    model: 'sonnet',
    heartbeat: { interval: '30m' },
  },
  {
    id: 'research',
    name: 'Research Analyst',
    description: 'Gathers, synthesizes, and reports on information',
    toolPreset: 'full',
    model: 'sonnet',
    heartbeat: { interval: '4h' },
  },
  {
    id: 'ops',
    name: 'Ops Monitor',
    description: 'Monitors systems, checks health, handles incidents',
    toolPreset: 'full',
    model: 'sonnet',
    heartbeat: { interval: '15m' },
  },
  {
    id: 'pm',
    name: 'Project Manager',
    description: 'Tracks tasks, coordinates work, keeps projects moving',
    toolPreset: 'messaging',
    model: 'sonnet',
    heartbeat: { interval: '1h' },
  },
]

// ---------------------------------------------------------------------------
// Onboarding — streamlined default orchestrator creation
// ---------------------------------------------------------------------------

export function OnboardingPage({
  onCreated,
  onPickTemplate,
}: {
  onCreated: () => void
  onPickTemplate: () => void
}) {
  const [name, setName] = useState('assistant')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const nameSlug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'assistant'

  // Capitalize the user's name for the display name
  const displayName = name.trim()
    ? name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : 'Assistant'

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    try {
      await api('/agents', {
        method: 'POST',
        body: {
          name: nameSlug,
          template: 'orchestrator',
          description: displayName,
          setAsDefault: true,
        },
      })
      onCreated()
    } catch (e: any) {
      setError(e.message)
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-8">
      <div className="w-full max-w-md text-center">
        <div className="mb-4 text-6xl">{'\uD83D\uDD2E'}</div>
        <h1 className="text-3xl font-bold mb-2 text-foreground">
          Welcome to Clade
        </h1>
        <p className="text-base mb-1 text-muted-foreground">
          Your personal team of AI agents, powered by Claude Code.
        </p>
        <p className="text-sm mb-8 text-muted-foreground/60">
          Let's create your first agent — a personal assistant that can handle
          anything and delegate to specialists.
        </p>

        <div className="text-left space-y-5">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Name your assistant
            </Label>
            <Input
              ref={inputRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. assistant, jarvis, friday"
              className="text-base h-12"
            />
            {nameSlug && nameSlug !== name.trim().toLowerCase() && (
              <p className="text-xs text-muted-foreground/60">
                Will be created as:{' '}
                <code className="text-primary font-mono">{nameSlug}</code>
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-md text-sm bg-destructive/10 border border-destructive/30 text-destructive">
              {error}
            </div>
          )}

          <Button
            className="w-full h-12 text-[15px]"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                Get Started
              </>
            )}
          </Button>
        </div>

        <button
          className="mt-6 text-sm text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          onClick={onPickTemplate}
        >
          Or pick a specialist template instead
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CreateAgentForm({
  template,
  onCancel,
  onCreated,
}: {
  template: Template
  onCancel: () => void
  onCreated: () => void
}) {
  const meta = TEMPLATE_META[template.id] || DEFAULT_META
  const [name, setName] = useState('')
  const [description, setDescription] = useState(template.name)
  const [model, setModel] = useState(template.model || 'sonnet')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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
      await api('/agents', {
        method: 'POST',
        body: {
          name: nameSlug,
          template: template.id,
          description,
          model,
        },
      })
      onCreated()
    } catch (e: any) {
      setError(e.message)
    }
    setCreating(false)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-8">
      <div className="w-full max-w-md">
        {/* Back link */}
        <button
          className="flex items-center gap-1.5 mb-6 text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={onCancel}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to templates
        </button>

        {/* Template badge */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className={cn(
              "flex items-center justify-center rounded-xl w-12 h-12 text-2xl border",
              meta.bgClass,
              meta.borderClass,
            )}
          >
            {meta.icon}
          </div>
          <div>
            <div className={cn("text-lg font-bold", meta.colorClass)}>
              {template.name}
            </div>
            <div className="text-sm text-muted-foreground">
              {template.description}
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Agent Name
            </Label>
            <Input
              ref={inputRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              placeholder="e.g. jarvis, ravi, manu"
              className="text-base h-12"
            />
            {nameSlug && nameSlug !== name && (
              <p className="text-xs text-muted-foreground/60">
                Will be created as:{' '}
                <code className="text-primary font-mono">{nameSlug}</code>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Description
            </Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this agent do?"
              className="text-base h-12"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Model
            </Label>
            <div className="flex gap-2">
              {['sonnet', 'opus', 'haiku'].map((m) => (
                <Button
                  key={m}
                  variant={model === m ? 'default' : 'outline'}
                  className="flex-1 capitalize"
                  onClick={() => setModel(m)}
                >
                  {m}
                </Button>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-md text-sm bg-destructive/10 border border-destructive/30 text-destructive">
              {error}
            </div>
          )}

          <Button
            className="w-full h-12 text-[15px]"
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
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function WelcomePage({ onCreated }: WelcomePageProps) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [selected, setSelected] = useState<Template | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<{ templates: Template[] }>('/templates')
      .then((d) => setTemplates(d.templates || []))
      .catch(() => {
        setTemplates(FALLBACK_TEMPLATES)
      })
      .finally(() => setLoading(false))
  }, [])

  if (selected) {
    return (
      <CreateAgentForm
        template={selected}
        onCancel={() => setSelected(null)}
        onCreated={onCreated}
      />
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-8">
      <div className="w-full max-w-[720px] text-center">
        {/* Hero */}
        <div className="mb-2 text-5xl">{'\uD83D\uDD2E'}</div>
        <h1 className="text-3xl font-bold mb-2 text-foreground">
          Welcome to Clade
        </h1>
        <p className="text-base mb-1 text-muted-foreground max-w-md mx-auto">
          Your personal team of AI agents, powered by Claude Code.
        </p>
        <p className="text-sm mb-8 text-muted-foreground/60 max-w-md mx-auto">
          Create your first agent to get started. Pick a template, or build one
          from scratch.
        </p>

        {/* Template cards */}
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading templates...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
            {templates.map((t) => {
              const meta = TEMPLATE_META[t.id] || DEFAULT_META
              return (
                <Card
                  key={t.id}
                  className={cn(
                    "cursor-pointer transition-all hover:-translate-y-0.5 border-2",
                    meta.borderClass,
                    meta.bgClass,
                  )}
                  onClick={() => setSelected(t)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className={cn(
                          "flex items-center justify-center rounded-xl w-11 h-11 text-[22px] border",
                          meta.bgClass,
                          meta.borderClass,
                        )}
                      >
                        {meta.icon}
                      </div>
                      <div>
                        <div className={cn("text-sm font-bold", meta.colorClass)}>
                          {t.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t.toolPreset} preset
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t.description}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
                      <span>Model: {t.model}</span>
                      <span>{'\u00B7'}</span>
                      <span>
                        Heartbeat: {t.heartbeat?.interval || '30m'}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Custom agent card */}
        <Card
          className="mt-4 cursor-pointer border-2 border-dashed border-muted-foreground/30 hover:border-foreground/50 transition-all hover:-translate-y-0.5 text-left"
          onClick={() =>
            setSelected({
              id: 'custom',
              name: 'Custom Agent',
              description: 'Build from scratch',
              toolPreset: 'full',
              model: 'sonnet',
            })
          }
        >
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-xl w-11 h-11 text-[22px] border border-dashed border-muted-foreground/30 bg-secondary/30">
                <Sparkles className="h-5 w-5 text-foreground" />
              </div>
              <div>
                <div className="text-sm font-bold text-foreground">
                  Custom Agent
                </div>
                <div className="text-xs text-muted-foreground">
                  Build from scratch -- define your own personality, tools, and
                  schedule
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CLI hint */}
        <Card className="mt-8">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              Or use the CLI:{' '}
              <code className="text-primary">
                clade agent add jarvis --template coding
              </code>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
