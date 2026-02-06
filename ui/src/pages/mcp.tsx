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
  FileText,
  Folder,
  File,
  X,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpServer {
  name: string
  description?: string
  status: 'active' | 'pending' | 'disabled'
  requestedBy?: string
  requested_by?: string
}

interface McpFile {
  name: string
  size: number
  content?: string
}

interface McpDetail {
  name: string
  status: string
  path: string
  files: McpFile[]
}

interface McpPageProps {
  mcpServers: McpServer[]
  onRefresh: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function McpPage({ mcpServers, onRefresh }: McpPageProps) {
  const [pkgName, setPkgName] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installStatus, setInstallStatus] = useState<{
    type: 'success' | 'error' | null
    message: string
  }>({ type: null, message: '' })

  // MCP server detail modal state
  const [selectedServer, setSelectedServer] = useState<{ name: string; status: string } | null>(null)
  const [serverDetail, setServerDetail] = useState<McpDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [selectedFile, setSelectedFile] = useState<McpFile | null>(null)

  const openServerDetail = async (name: string, status: string) => {
    setSelectedServer({ name, status })
    setLoadingDetail(true)
    setSelectedFile(null)
    try {
      const detail = await api<McpDetail>(`/mcp/${status}/${encodeURIComponent(name)}`)
      setServerDetail(detail)
      // Auto-select README.md if it exists
      const readme = detail.files.find(f => f.name === 'README.md')
      if (readme) setSelectedFile(readme)
    } catch (e: any) {
      console.error('Failed to load MCP server detail:', e.message)
      setServerDetail(null)
    }
    setLoadingDetail(false)
  }

  const closeServerDetail = () => {
    setSelectedServer(null)
    setServerDetail(null)
    setSelectedFile(null)
  }

  const active = mcpServers.filter((s) => s.status === 'active')
  const pending = mcpServers.filter((s) => s.status === 'pending')
  const disabled = mcpServers.filter((s) => s.status === 'disabled')

  const approve = async (name: string) => {
    try {
      await api('/mcp/' + encodeURIComponent(name) + '/approve', { method: 'POST' })
      onRefresh()
    } catch (e: any) {
      console.error('Approve failed:', e.message)
    }
  }

  const reject = async (name: string) => {
    try {
      await api('/mcp/' + encodeURIComponent(name) + '/reject', { method: 'POST' })
      onRefresh()
    } catch (e: any) {
      console.error('Reject failed:', e.message)
    }
  }

  const remove = async (name: string) => {
    try {
      await api('/mcp/' + encodeURIComponent(name), { method: 'DELETE' })
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
        '/mcp/install',
        { method: 'POST', body: { package: pkgName.trim() } }
      )
      if (result.success) {
        setInstallStatus({ type: 'success', message: result.message || 'MCP server installed to pending' })
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
        <h2 className="text-xl font-semibold text-foreground">MCP Servers</h2>
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
                      onClick={() => openServerDetail(s.name, 'pending')}
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

      {/* Active MCP servers */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[hsl(var(--success))]">
          <CheckCircle2 className="h-4 w-4" />
          Active MCP Servers ({active.length})
        </h3>
        {active.length === 0 ? (
          <Card className="border-[hsl(var(--success))]/20">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">
                No active MCP servers installed.
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
                    <button
                      onClick={() => openServerDetail(s.name, 'active')}
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

      {/* Disabled MCP servers */}
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

      {/* Empty state when there are no MCP servers at all */}
      {mcpServers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Puzzle className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No MCP servers</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Install MCP servers from npm below
          </p>
        </div>
      )}

      {/* Install MCP server form */}
      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Download className="h-4 w-4" />
            Install MCP Server
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
            MCP servers are installed from npm. New servers go to pending and
            require approval.
          </p>
        </CardContent>
      </Card>

      {/* MCP Server Detail Modal */}
      <Dialog open={!!selectedServer} onOpenChange={(open) => !open && closeServerDetail()}>
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Puzzle className="h-5 w-5" />
              {selectedServer?.name}
              <Badge variant={selectedServer?.status === 'active' ? 'default' : 'secondary'}>
                {selectedServer?.status}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {loadingDetail ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : serverDetail ? (
            <div className="flex gap-4 flex-1 min-h-0">
              {/* File list sidebar */}
              <div className="w-48 shrink-0 border-r pr-4">
                <div className="text-xs font-medium text-muted-foreground mb-2">Files</div>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-1">
                    {serverDetail.files.map((file) => (
                      <button
                        key={file.name}
                        onClick={() => setSelectedFile(file)}
                        className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
                          selectedFile?.name === file.name
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-muted text-foreground'
                        }`}
                      >
                        {file.name.endsWith('/') ? (
                          <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : file.name.endsWith('.md') ? (
                          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <File className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        <span className="truncate">{file.name}</span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* File content */}
              <div className="flex-1 min-w-0">
                {selectedFile ? (
                  <div className="h-full flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium">{selectedFile.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {selectedFile.size > 1024
                          ? `${(selectedFile.size / 1024).toFixed(1)} KB`
                          : `${selectedFile.size} bytes`}
                      </div>
                    </div>
                    <ScrollArea className="flex-1 h-[380px] rounded border bg-muted/30">
                      {selectedFile.content ? (
                        <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words">
                          {selectedFile.content}
                        </pre>
                      ) : selectedFile.name.endsWith('/') ? (
                        <div className="p-4 text-sm text-muted-foreground">
                          Directory (contents not shown)
                        </div>
                      ) : (
                        <div className="p-4 text-sm text-muted-foreground">
                          Binary or large file (content not available)
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    Select a file to view its contents
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              Failed to load MCP server details
            </div>
          )}

          {serverDetail && (
            <div className="pt-4 border-t text-xs text-muted-foreground">
              Path: {serverDetail.path}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
