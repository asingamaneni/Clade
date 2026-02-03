import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

interface TopbarProps {
  connected: boolean
  health: Record<string, unknown> | null
  agentCount: number
}

export function TopBar({ connected, health, agentCount }: TopbarProps) {
  const port = health && typeof health === 'object' && 'port' in health
    ? (health as { port: number }).port
    : null

  return (
    <div className="flex h-12 items-center justify-between border-b px-4">
      {/* Left: page title */}
      <h1 className="text-sm font-semibold tracking-tight text-foreground/90">
        Clade Admin
      </h1>

      {/* Right: status indicators */}
      <div className="flex items-center gap-3">
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

        {/* Connection status */}
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "h-2 w-2 rounded-full",
              connected
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
