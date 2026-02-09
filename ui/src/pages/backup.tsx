import { useState, useEffect, useCallback } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { showToast } from "@/App"
import {
  HardDrive, RefreshCw, Play, Clock, GitCommit, AlertCircle,
  CheckCircle2, ExternalLink, Copy
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BackupStatus {
  enabled: boolean
  repo: string
  branch: string
  lastBackupAt?: string
  lastCommitSha?: string
  lastError?: string
  dirty: boolean
  intervalMinutes: number
}

interface HistoryEntry {
  sha: string
  message: string
  date: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso?: string): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BackupPage() {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [backing, setBacking] = useState(false)
  const [saving, setSaving] = useState(false)

  // Local settings state
  const [enabled, setEnabled] = useState(false)
  const [interval, setInterval_] = useState(30)
  const [excludeChats, setExcludeChats] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const s = await api<BackupStatus>('/backup/status')
      setStatus(s)
      setEnabled(s.enabled)
      setInterval_(s.intervalMinutes)
    } catch { /* ignore */ }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const h = await api<{ entries: HistoryEntry[] }>('/backup/history?limit=20')
      setHistory(h.entries || [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    Promise.all([fetchStatus(), fetchHistory()]).finally(() => setLoading(false))
  }, [fetchStatus, fetchHistory])

  const triggerBackup = async () => {
    setBacking(true)
    try {
      const result = await api<{ changed: boolean; filesChanged: number; commitSha: string; pushed: boolean; error?: string }>(
        '/backup/now', { method: 'POST' }
      )
      if (result.error) {
        showToast(result.error, 'error')
      } else if (result.changed) {
        showToast(`Backup complete: ${result.filesChanged} file(s)`, 'success')
      } else {
        showToast('No changes to back up', 'info')
      }
      fetchStatus()
      fetchHistory()
    } catch (e: any) {
      showToast(e.message || 'Backup failed', 'error')
    }
    setBacking(false)
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      await api('/backup/config', {
        method: 'PUT',
        body: { enabled, intervalMinutes: interval, excludeChats },
      })
      showToast('Settings saved', 'success')
      fetchStatus()
    } catch (e: any) {
      showToast(e.message || 'Save failed', 'error')
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const isConfigured = status && status.repo

  // ── Not configured — show setup guide ─────────────────────────
  if (!isConfigured) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-foreground">Backup</h2>
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <HardDrive className="h-8 w-8 text-muted-foreground/50" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Auto-Backup to GitHub
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Automatically commit and push your agent data to a private GitHub repo
                </p>
              </div>
            </div>
            <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Set up backup from the command line:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-background rounded px-3 py-2 text-xs font-mono text-foreground border">
                  clade backup setup --repo your-username/clade-backup
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText('clade backup setup --repo your-username/clade-backup')
                    showToast('Copied to clipboard', 'info')
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This will initialize a git repo in ~/.clade and push to GitHub.
                Requires <code className="text-foreground">git</code> and <code className="text-foreground">gh</code> CLI to be installed.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Configured — show full UI ─────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Backup</h2>
        <Button
          size="sm"
          onClick={triggerBackup}
          disabled={backing}
        >
          {backing ? (
            <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Backing up...</>
          ) : (
            <><Play className="h-3.5 w-3.5 mr-1.5" /> Backup Now</>
          )}
        </Button>
      </div>

      {/* Status card */}
      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Status</p>
              <div className="flex items-center gap-1.5">
                {status.enabled ? (
                  <><CheckCircle2 className="h-3.5 w-3.5 text-green-400" /><span className="text-sm font-medium text-green-400">Active</span></>
                ) : (
                  <><AlertCircle className="h-3.5 w-3.5 text-yellow-400" /><span className="text-sm font-medium text-yellow-400">Paused</span></>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Repository</p>
              <a
                href={`https://github.com/${status.repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-blue-400 hover:underline flex items-center gap-1"
              >
                {status.repo}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Last Backup</p>
              <p className="text-sm font-medium text-foreground">
                {timeAgo(status.lastBackupAt)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Interval</p>
              <p className="text-sm font-medium text-foreground">
                Every {status.intervalMinutes}m
              </p>
            </div>
          </div>

          {status.lastError && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-red-400">Last Error</p>
                  <p className="text-xs text-red-400/80 mt-0.5">{status.lastError}</p>
                </div>
              </div>
            </div>
          )}

          {status.dirty && !status.lastError && (
            <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-yellow-400" />
                <p className="text-xs text-yellow-400">Uncommitted changes detected</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settings card */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Auto-backup</Label>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Interval</Label>
              <select
                value={interval}
                onChange={e => setInterval_(Number(e.target.value))}
                className={selectClass}
              >
                <option value={15}>Every 15 minutes</option>
                <option value={30}>Every 30 minutes</option>
                <option value={60}>Every hour</option>
                <option value={240}>Every 4 hours</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Exclude chats</Label>
              <Switch checked={excludeChats} onCheckedChange={setExcludeChats} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={saveSettings} disabled={saving}>
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* History table */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">History</h3>
            <Button variant="ghost" size="sm" onClick={fetchHistory}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <GitCommit className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">No backup history yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-secondary/50">
                    <th className="text-left text-xs font-medium px-3 py-2 text-muted-foreground">Commit</th>
                    <th className="text-left text-xs font-medium px-3 py-2 text-muted-foreground">Message</th>
                    <th className="text-left text-xs font-medium px-3 py-2 text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.sha} className="border-b">
                      <td className="px-3 py-2 text-xs font-mono text-blue-400">{entry.sha}</td>
                      <td className="px-3 py-2 text-xs text-foreground">{entry.message}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(entry.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
