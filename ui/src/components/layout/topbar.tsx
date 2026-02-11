import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

interface TopbarProps {
  connected: boolean
  health: Record<string, unknown> | null
  agentCount: number
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function TopBar({ connected, health, agentCount }: TopbarProps) {
  const port = health && typeof health === 'object' && 'port' in health
    ? (health as { port: number }).port
    : null
  const uptime = health && typeof health === 'object' && 'uptime' in health
    ? (health as { uptime: number }).uptime
    : null
  const version = health && typeof health === 'object' && 'version' in health
    ? (health as { version: string }).version
    : null
  const status = health && typeof health === 'object' && 'status' in health
    ? (health as { status: string }).status
    : null

  return (
    <div className="flex h-12 items-center justify-between border-b px-4">
      {/* Left: page title */}
      <h1 className="text-sm font-semibold tracking-tight text-foreground/90">
        Clade Admin
      </h1>

      {/* Right: status indicators */}
      <div className="flex items-center gap-3">
        {/* Version */}
        {version && (
          <span className="text-[10px] font-mono text-muted-foreground/60">
            v{version}
          </span>
        )}

        {/* Uptime */}
        {uptime != null && (
          <Badge variant="outline" className="gap-1 text-[10px] font-mono font-normal text-muted-foreground">
            <span className="opacity-60">up</span> {formatUptime(uptime)}
          </Badge>
        )}

        {/* Agent count */}
        <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
          <span role="img" aria-label="agents">🤖</span>
          {agentCount} {agentCount === 1 ? 'agent' : 'agents'}
        </Badge>

        {/* Port display */}
        {port != null && (
          <Badge variant="outline" className="text-xs font-mono font-normal text-muted-foreground">
            :{port}
          </Badge>
        )}

        {/* Server status + connection */}
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "h-2 w-2 rounded-full",
              connected && status === 'ok'
                ? "bg-[hsl(var(--success))] shadow-[0_0_6px_hsl(var(--success)/0.5)]"
                : "bg-destructive shadow-[0_0_6px_hsl(var(--destructive)/0.4)]"
            )}
          />
          <span className="text-xs text-muted-foreground">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>
    </div>
  )
}
