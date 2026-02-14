import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, Loader2, Check, Wrench, Brain, X } from 'lucide-react'
import type { ActivityStep } from '@/hooks/use-chat'

interface ActivityTimelineProps {
  steps: ActivityStep[]
  agentEmoji?: string
  /** Start collapsed (used for completed messages) */
  collapsed?: boolean
}

// Tool name -> human-readable label mapping
const TOOL_LABELS: Record<string, string> = {
  Read: 'Reading file',
  Edit: 'Editing file',
  Write: 'Writing file',
  Bash: 'Running command',
  Glob: 'Searching files',
  Grep: 'Searching content',
  WebFetch: 'Fetching web page',
  WebSearch: 'Searching the web',
  Task: 'Running sub-task',
  TodoWrite: 'Updating todos',
  NotebookEdit: 'Editing notebook',
}

function getToolLabel(toolName: string): string {
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName]

  // MCP tool: mcp__server__tool_name -> "Server: tool_name"
  const mcpMatch = toolName.match(/^mcp__([^_]+(?:-[^_]+)*)__(.+)$/)
  if (mcpMatch) {
    const server = mcpMatch[1]
    const tool = mcpMatch[2].replace(/_/g, ' ')
    const serverLabels: Record<string, string> = {
      memory: 'Memory',
      sessions: 'Sessions',
      messaging: 'Messaging',
      'mcp-manager': 'MCP Manager',
      platform: 'Platform',
      collaboration: 'Collaboration',
      admin: 'Admin',
    }
    return `${serverLabels[server] || server}: ${tool}`
  }

  return toolName
}

function getToolBrief(step: ActivityStep): string | null {
  if (!step.toolInput) return null
  const input = step.toolInput
  if (typeof input.file_path === 'string') return input.file_path.split('/').pop() || null
  if (typeof input.path === 'string') return input.path.split('/').pop() || null
  if (typeof input.pattern === 'string') return input.pattern
  if (typeof input.command === 'string') return (input.command as string).slice(0, 60)
  if (typeof input.query === 'string') return (input.query as string).slice(0, 60)
  if (typeof input.url === 'string') return (input.url as string).slice(0, 60)
  return null
}

function formatDuration(startMs: number, endMs?: number): string {
  const elapsed = (endMs || Date.now()) - startMs
  if (elapsed < 1000) return '<1s'
  if (elapsed < 60000) return Math.round(elapsed / 1000) + 's'
  return Math.round(elapsed / 60000) + 'm'
}

function stripSystemTags(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
}

function formatInputForDisplay(input: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      lines.push(`${key}: ${value.length > 200 ? value.slice(0, 200) + '...' : value}`)
    } else {
      lines.push(`${key}: ${JSON.stringify(value).slice(0, 200)}`)
    }
  }
  return lines.join('\n')
}

export function ActivityTimeline({ steps, agentEmoji, collapsed: startCollapsed }: ActivityTimelineProps) {
  const [expanded, setExpanded] = useState(!startCollapsed)
  const [selectedStep, setSelectedStep] = useState<string | null>(null)
  // Force re-render to update durations for running steps
  const [, setTick] = useState(0)

  useEffect(() => {
    const hasRunning = steps.some((s) => s.status === 'running')
    if (!hasRunning) return
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [steps])

  if (steps.length === 0) return null

  const allDone = steps.every((s) => s.status === 'done')
  const currentStep = steps[steps.length - 1]
  const currentLabel = allDone
    ? `Completed ${steps.length} step${steps.length !== 1 ? 's' : ''}`
    : currentStep.type === 'thinking'
      ? 'Thinking...'
      : currentStep.status === 'running'
        ? getToolLabel(currentStep.toolName || '') + '...'
        : 'Processing...'

  const selectedStepData = selectedStep ? steps.find((s) => s.id === selectedStep) : null

  return (
    <div className="flex items-start gap-2 mb-1">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-sm mt-0.5">
        {agentEmoji || '\uD83E\uDD16'}
      </div>
      <div className="max-w-[75%] rounded-xl rounded-bl-sm border border-border bg-card overflow-hidden">
        {/* Header: current status + collapse toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-secondary/30 transition-colors"
        >
          {!allDone ? (
            <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
          ) : (
            <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          )}
          <span className="text-xs font-medium text-foreground/80 truncate">
            {currentLabel}
          </span>
          {!allDone && (
            <span className="ml-auto text-[10px] text-muted-foreground/50 whitespace-nowrap">
              {steps.length} step{steps.length !== 1 ? 's' : ''}
            </span>
          )}
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          )}
        </button>

        {/* Expanded timeline */}
        {expanded && (
          <div className="border-t border-border/50 px-3 py-1.5 space-y-0.5 max-h-[200px] overflow-y-auto">
            {steps.map((step) => {
              const brief = step.type === 'tool' ? getToolBrief(step) : null
              const hasDetail = step.type === 'tool' && (step.toolInput || step.toolResult)
              const isSelected = selectedStep === step.id
              return (
                <div key={step.id}>
                  <div
                    className={cn(
                      'flex items-center gap-2 py-0.5 rounded',
                      hasDetail && 'cursor-pointer hover:bg-secondary/30',
                      isSelected && 'bg-secondary/30'
                    )}
                    onClick={hasDetail ? () => setSelectedStep(isSelected ? null : step.id) : undefined}
                  >
                    {step.status === 'running' ? (
                      <Loader2 className="h-3 w-3 text-primary animate-spin shrink-0" />
                    ) : (
                      <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                    )}

                    {step.type === 'thinking' ? (
                      <Brain className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                    ) : (
                      <Wrench className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                    )}

                    <span
                      className={cn(
                        'text-[11px] truncate',
                        step.status === 'running'
                          ? 'text-foreground/80'
                          : 'text-muted-foreground/60'
                      )}
                    >
                      {step.type === 'thinking'
                        ? 'Thinking'
                        : getToolLabel(step.toolName || '')}
                    </span>

                    {brief && (
                      <span className="text-[10px] text-muted-foreground/40 truncate max-w-[150px]">
                        {brief}
                      </span>
                    )}

                    <span className="ml-auto text-[10px] text-muted-foreground/40 shrink-0 whitespace-nowrap">
                      {formatDuration(step.startedAt, step.completedAt)}
                    </span>
                  </div>

                  {/* Detail panel for clicked step */}
                  {isSelected && selectedStepData && (
                    <div className="ml-5 mt-1 mb-2 border border-border/40 rounded-lg bg-secondary/20 overflow-hidden">
                      <div className="flex items-center justify-between px-2 py-1 border-b border-border/30">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          {selectedStepData.toolName}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedStep(null) }}
                          className="text-muted-foreground/50 hover:text-muted-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      {selectedStepData.toolInput && Object.keys(selectedStepData.toolInput).length > 0 && (
                        <div className="px-2 py-1.5 border-b border-border/30">
                          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mb-0.5">Input</div>
                          <pre className="text-[10px] text-muted-foreground/70 whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto font-mono">
                            {formatInputForDisplay(selectedStepData.toolInput)}
                          </pre>
                        </div>
                      )}
                      {selectedStepData.toolResult && (
                        <div className="px-2 py-1.5">
                          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mb-0.5">Output</div>
                          <pre className="text-[10px] text-muted-foreground/70 whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto font-mono">
                            {stripSystemTags(selectedStepData.toolResult)}
                          </pre>
                        </div>
                      )}
                      {!selectedStepData.toolResult && selectedStepData.status === 'done' && (
                        <div className="px-2 py-1.5">
                          <div className="text-[10px] text-muted-foreground/40 italic">No output captured</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
