import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { api } from "@/lib/api"
import {
  RefreshCw,
  Puzzle,
  CheckCircle2,
  Clock,
  Ban,
  Download,
  ThumbsUp,
  ThumbsDown,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Skill {
  name: string
  description?: string
  status: 'active' | 'pending' | 'disabled'
  requestedBy?: string
  requested_by?: string
}

interface SkillsPageProps {
  skills: Skill[]
  onRefresh: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillsPage({ skills, onRefresh }: SkillsPageProps) {
  const [pkgName, setPkgName] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installStatus, setInstallStatus] = useState<{
    type: 'success' | 'error' | null
    message: string
  }>({ type: null, message: '' })

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
    if (!pkgName.trim()) return
    setInstalling(true)
    setInstallStatus({ type: null, message: '' })
    try {
      const result = await api<{ success?: boolean; message?: string; error?: string }>(
        '/skills/install',
        { method: 'POST', body: { package: pkgName.trim() } }
      )
      if (result.success) {
        setInstallStatus({ type: 'success', message: result.message || 'Skill installed to pending' })
        setPkgName('')
        onRefresh()
        // Clear success message after 5 seconds
        setTimeout(() => setInstallStatus({ type: null, message: '' }), 5000)
      } else {
        setInstallStatus({ type: 'error', message: result.error || 'Installation failed' })
      }
    } catch (e: any) {
      setInstallStatus({ type: 'error', message: e.message || 'Installation failed' })
    }
    setInstalling(false)
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
                    <div className="text-sm font-medium text-foreground">
                      {s.name}
                    </div>
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
            {active.map((s) => (
              <Card
                key={s.name}
                className="border-[hsl(var(--success))]/30"
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {s.name}
                    </div>
                    {s.description && (
                      <div className="text-xs mt-0.5 truncate text-muted-foreground">
                        {s.description}
                      </div>
                    )}
                  </div>
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
          <Puzzle className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No skills</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Install MCP server skills from npm below
          </p>
        </div>
      )}

      {/* Install skill form */}
      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Download className="h-4 w-4" />
            Install Skill
          </h3>
          <div className="flex gap-2">
            <Input
              value={pkgName}
              onChange={(e) => setPkgName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !installing && install()}
              placeholder="npm package name (e.g. @mcp/weather-server)"
              className="flex-1"
              disabled={installing}
            />
            <Button onClick={install} disabled={installing || !pkgName.trim()}>
              {installing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Installing...
                </>
              ) : (
                'Install'
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
            Skills are standard MCP servers from npm. New skills go to pending and
            require approval.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
