import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { RefreshCw, Plus, Trash2, Clock, X, Pencil } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronJob {
  id: string
  name: string
  schedule: string
  agentId?: string
  agent_id?: string
  timezone?: string
  enabled?: boolean
  lastRun?: string
  last_run_at?: string
  prompt?: string
}

export interface Agent {
  id: string
  name: string
  description?: string
  emoji?: string
}

interface CronPageProps {
  cronJobs: CronJob[]
  agents: Agent[]
  onRefresh: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Australia/Sydney',
  'Australia/Perth',
  'Pacific/Auckland',
]

const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d?: string | null): string {
  if (!d) return 'Never'
  try {
    return new Date(d).toLocaleString()
  } catch {
    return String(d)
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CronPage({ cronJobs, agents, onRefresh }: CronPageProps) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '',
    schedule: '0 * * * *',
    agentId: '',
    prompt: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  const [creating, setCreating] = useState(false)

  // Edit modal state
  const [editingJob, setEditingJob] = useState<CronJob | null>(null)
  const [editForm, setEditForm] = useState({ name: '', schedule: '', agentId: '', prompt: '', timezone: '' })
  const [saving, setSaving] = useState(false)

  const openEditModal = (job: CronJob) => {
    setEditForm({
      name: job.name,
      schedule: job.schedule,
      agentId: job.agentId || job.agent_id || '',
      prompt: job.prompt || '',
      timezone: job.timezone || 'UTC',
    })
    setEditingJob(job)
  }

  const saveEdit = async () => {
    if (!editingJob) return
    setSaving(true)
    try {
      await api('/cron/' + editingJob.id, {
        method: 'PATCH',
        body: editForm,
      })
      setEditingJob(null)
      onRefresh()
    } catch (e: any) {
      console.error('Save failed:', e.message)
    }
    setSaving(false)
  }

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const createJob = async () => {
    if (!form.name || !form.schedule || !form.agentId || !form.prompt) {
      console.error('All fields are required')
      return
    }
    setCreating(true)
    try {
      await api('/cron', { method: 'POST', body: form })
      setForm({ name: '', schedule: '0 * * * *', agentId: '', prompt: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      setShowForm(false)
      onRefresh()
    } catch (e: any) {
      console.error('Create failed:', e.message)
    }
    setCreating(false)
  }

  const toggleJob = async (job: CronJob) => {
    try {
      await api('/cron/' + job.id, {
        method: 'PATCH',
        body: { enabled: !job.enabled },
      })
      onRefresh()
    } catch (e: any) {
      console.error('Toggle failed:', e.message)
    }
  }

  const deleteJob = async (id: string) => {
    try {
      await api('/cron/' + id, { method: 'DELETE' })
      onRefresh()
    } catch (e: any) {
      console.error('Delete failed:', e.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Cron Jobs</h2>
        <Button
          variant={showForm ? 'secondary' : 'default'}
          size="sm"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? (
            <>
              <X className="h-3.5 w-3.5 mr-1.5" />
              Cancel
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Job
            </>
          )}
        </Button>
      </div>

      {/* Add job form */}
      {showForm && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">
              New Cron Job
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="e.g. daily-digest"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Schedule (cron)
                </Label>
                <Input
                  value={form.schedule}
                  onChange={(e) => updateField('schedule', e.target.value)}
                  placeholder="0 * * * *"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Agent</Label>
                <select
                  value={form.agentId}
                  onChange={(e) => updateField('agentId', e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select agent...</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || a.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Timezone</Label>
                <select
                  value={form.timezone}
                  onChange={(e) => updateField('timezone', e.target.value)}
                  className={selectClass}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Prompt</Label>
              <Textarea
                value={form.prompt}
                onChange={(e) => updateField('prompt', e.target.value)}
                placeholder="What should the agent do on each run..."
                className="min-h-[80px]"
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={createJob} disabled={creating}>
                {creating ? 'Creating...' : 'Create Job'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Jobs table */}
      {cronJobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Clock className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            No cron jobs
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Create a job to run agents on a schedule
          </p>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="text-left text-xs font-medium px-4 py-3 text-muted-foreground">
                    Name
                  </th>
                  <th className="text-left text-xs font-medium px-4 py-3 text-muted-foreground">
                    Schedule
                  </th>
                  <th className="text-left text-xs font-medium px-4 py-3 text-muted-foreground">
                    Timezone
                  </th>
                  <th className="text-left text-xs font-medium px-4 py-3 text-muted-foreground">
                    Agent
                  </th>
                  <th className="text-left text-xs font-medium px-4 py-3 text-muted-foreground">
                    Enabled
                  </th>
                  <th className="text-left text-xs font-medium px-4 py-3 text-muted-foreground">
                    Last Run
                  </th>
                  <th className="text-right text-xs font-medium px-4 py-3 text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {cronJobs.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b cursor-pointer hover:bg-secondary/30 transition-colors"
                    onClick={() => openEditModal(job)}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-foreground">
                      {job.name}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                      {job.schedule}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {job.timezone || 'UTC'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {job.agentId || job.agent_id || '--'}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <Switch
                        checked={!!job.enabled}
                        onCheckedChange={() => toggleJob(job)}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(job.lastRun || job.last_run_at)}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => deleteJob(job.id)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {/* Edit modal */}
      <Dialog open={!!editingJob} onOpenChange={(open) => { if (!open) setEditingJob(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Cron Job</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={editForm.name}
                onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Schedule (cron)</Label>
              <Input
                value={editForm.schedule}
                onChange={e => setEditForm(prev => ({ ...prev, schedule: e.target.value }))}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Timezone</Label>
              <select
                value={editForm.timezone}
                onChange={e => setEditForm(prev => ({ ...prev, timezone: e.target.value }))}
                className={selectClass}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Agent</Label>
              <select
                value={editForm.agentId}
                onChange={e => setEditForm(prev => ({ ...prev, agentId: e.target.value }))}
                className={selectClass}
              >
                <option value="">Select agent...</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || a.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Prompt</Label>
              <Textarea
                value={editForm.prompt}
                onChange={e => setEditForm(prev => ({ ...prev, prompt: e.target.value }))}
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingJob(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
