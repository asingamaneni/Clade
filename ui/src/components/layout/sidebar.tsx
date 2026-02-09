import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  LayoutDashboard, MessageSquare, Bot, FolderOpen, Puzzle, BookOpen,
  Radio, Clock, Settings, ChevronRight, User, Zap, CalendarDays, Search, HardDrive
} from "lucide-react"

interface Agent {
  id: string
  name: string
  description?: string
  model?: string
  toolPreset?: string
  emoji?: string
}

interface SidebarProps {
  page: string
  onPageChange: (page: string) => void
  agents: Agent[]
  onNavigateToAgent?: (agentId: string) => void
}

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'user', label: 'User Profile', icon: User },
  { id: 'sessions', label: 'Sessions', icon: FolderOpen },
  { id: 'mcp', label: 'MCP Servers', icon: Puzzle },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'channels', label: 'Channels', icon: Radio },
  { id: 'cron', label: 'Cron', icon: Clock },
  { id: 'activity', label: 'Activity', icon: Zap },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'backup', label: 'Backup', icon: HardDrive },
  { id: 'config', label: 'Config', icon: Settings },
]

export function Sidebar({ page, onPageChange, agents, onNavigateToAgent }: SidebarProps) {
  return (
    <div className="flex h-full w-56 flex-col bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 px-4">
        <span className="text-xl" role="img" aria-label="crystal ball">
          🔮
        </span>
        <span className="text-lg font-bold text-sidebar-foreground tracking-tight">
          Clade
        </span>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Navigation */}
      <ScrollArea className="flex-1 px-2 py-2">
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = page === item.id
            return (
              <Tooltip key={item.id} delayDuration={600}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    className={cn(
                      "w-full justify-start gap-3 rounded-md px-3 py-2 text-sm font-medium",
                      "text-sidebar-foreground/70 hover:bg-sidebar-accent/10 hover:text-sidebar-foreground",
                      isActive && "bg-sidebar-accent/15 text-sidebar-accent"
                    )}
                    onClick={() => onPageChange(item.id)}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isActive
                          ? "text-sidebar-accent"
                          : "text-sidebar-foreground/50"
                      )}
                    />
                    {item.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </nav>

        {/* Agent list */}
        {agents.length > 0 && (
          <>
            <Separator className="my-3 bg-sidebar-border" />
            <div className="px-3 pb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                Agents
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              {agents.map((agent) => (
                <Tooltip key={agent.id} delayDuration={600}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full justify-start gap-2 rounded-md px-3 py-1.5 text-sm",
                        "text-sidebar-foreground/60 hover:bg-sidebar-accent/10 hover:text-sidebar-foreground"
                      )}
                      onClick={() => onNavigateToAgent?.(agent.id)}
                    >
                      <span className="text-sm shrink-0">
                        {agent.emoji || '🤖'}
                      </span>
                      <span className="truncate">{agent.name}</span>
                      <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-sidebar-foreground/30" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    <p className="font-medium">{agent.name}</p>
                    {agent.description && (
                      <p className="text-muted-foreground">{agent.description}</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </>
        )}
      </ScrollArea>

      {/* Footer */}
      <Separator className="bg-sidebar-border" />
      <div className="px-4 py-3">
        <p className="text-[11px] text-sidebar-foreground/30">
          Clade v0.1.0
        </p>
      </div>
    </div>
  )
}
