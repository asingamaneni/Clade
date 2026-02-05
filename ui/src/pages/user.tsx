import { useState, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  User,
  Save,
  Loader2,
  Clock,
  Eye,
  ChevronRight,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VersionHistoryEntry {
  date: string
  summary: string
}

// ---------------------------------------------------------------------------
// Version History Viewer Component
// ---------------------------------------------------------------------------

function VersionHistoryViewer({
  entries,
  selectedDate,
  onSelect,
}: {
  entries: VersionHistoryEntry[]
  selectedDate: string | null
  onSelect: (date: string) => void
}) {
  if (entries.length === 0) {
    return (
      <div className="text-xs text-muted-foreground/60 py-4">
        No version history yet.
      </div>
    )
  }

  return (
    <ScrollArea className="max-h-[360px]">
      <div className="space-y-1.5 pr-3">
        {entries.map((entry) => (
          <button
            key={entry.date}
            onClick={() => onSelect(entry.date)}
            className="w-full text-left group"
          >
            <Card className={cn(
              "transition-colors hover:bg-accent/50 cursor-pointer",
              selectedDate === entry.date && "ring-1 ring-primary"
            )}>
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
  )
}

// ---------------------------------------------------------------------------
// User Profile Page
// ---------------------------------------------------------------------------

export function UserProfilePage() {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<VersionHistoryEntry[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedContent, setSelectedContent] = useState<string | null>(null)
  const [loadingEntry, setLoadingEntry] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [userRes, historyRes] = await Promise.all([
        api<{ content: string }>('/user'),
        api<{ entries: VersionHistoryEntry[] }>('/user/history'),
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
      // Reload history after save
      const historyRes = await api<{ entries: VersionHistoryEntry[] }>('/user/history')
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
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center rounded-full w-10 h-10 bg-secondary text-xl">
          <User className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">User Profile</h1>
          <p className="text-xs text-muted-foreground">
            Global preferences shared across all agents
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Editor */}
        <div className="lg:col-span-2 space-y-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="# USER.md — About You..."
            spellCheck={false}
            className="font-mono text-[13px] leading-relaxed min-h-[480px] max-h-[70vh] resize-y"
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
          <VersionHistoryViewer
            entries={history}
            selectedDate={selectedDate}
            onSelect={viewHistoryEntry}
          />
        </div>
      </div>

      {/* History entry viewer dialog */}
      <Dialog open={selectedDate !== null} onOpenChange={(open) => { if (!open) setSelectedDate(null) }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              USER.md snapshot — {selectedDate}
            </DialogTitle>
            <DialogDescription>
              This is a snapshot of USER.md from {selectedDate}.
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

      <Separator />

      {/* Info card */}
      <Card>
        <CardContent className="p-4">
          <h4 className="text-sm font-semibold text-foreground mb-2">
            About USER.md
          </h4>
          <p className="text-sm text-muted-foreground">
            USER.md contains information about you that helps all your agents serve you better.
            Store your identity, timezone, work schedule, communication preferences, and any
            context your agents should know. This file is shared across all agents and is
            injected into their system prompts.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
