import { useState, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { RefreshCw, Save, AlertTriangle, Loader2 } from "lucide-react"

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfigPage() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [parseErr, setParseErr] = useState<string | null>(null)

  const loadConfig = () => {
    setLoading(true)
    api<{ config: unknown }>('/config')
      .then((d) => {
        setText(JSON.stringify(d.config, null, 2))
        setParseErr(null)
      })
      .catch((e) => {
        console.error('Failed to load config:', e.message)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadConfig()
  }, [])

  const handleInput = (value: string) => {
    setText(value)
    try {
      JSON.parse(value)
      setParseErr(null)
    } catch (err: any) {
      setParseErr(err.message)
    }
  }

  const save = async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e: any) {
      console.error('Invalid JSON:', e.message)
      return
    }
    setSaving(true)
    try {
      await api('/config', { method: 'PUT', body: parsed })
      console.log('Configuration saved successfully')
    } catch (e: any) {
      console.error('Save failed:', e.message)
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading configuration...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Configuration</h2>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={loadConfig}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Reload
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving || !!parseErr}
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5 mr-1.5" />
                Save Config
              </>
            )}
          </Button>
        </div>
      </div>

      {/* JSON parse error indicator */}
      {parseErr && (
        <Card className="border-destructive/50">
          <CardContent className="p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">JSON error: {parseErr}</p>
          </CardContent>
        </Card>
      )}

      {/* JSON editor */}
      <Textarea
        value={text}
        onChange={(e) => handleInput(e.target.value)}
        spellCheck={false}
        className={cn(
          "font-mono text-[13px] leading-relaxed min-h-[520px] max-h-[75vh] resize-y",
          "tab-size-2",
          parseErr && "border-destructive/50 focus-visible:ring-destructive/30",
        )}
      />

      {/* File location hint */}
      <p className="text-xs text-muted-foreground/60">
        Validated against the Zod schema on save. Changes take effect
        immediately. File: <code className="text-primary">~/.clade/config.json</code>
      </p>
    </div>
  )
}
