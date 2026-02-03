import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { MessageSquare } from 'lucide-react'

interface ConversationPreview {
  messageCount: number
  lastMessage?: { text: string; role: string; timestamp: string } | null
}

interface Agent {
  id: string
  name: string
  description?: string
  model?: string
  toolPreset?: string
  emoji?: string
}

interface ChatSidebarProps {
  agents: Agent[]
  selectedAgent: string | null
  onSelectAgent: (agentId: string) => void
  wsConnected: boolean
  conversationPreviews: Record<string, ConversationPreview>
}

function formatRelativeTime(isoStr: string): string {
  if (!isoStr) return ''
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
  return Math.floor(diff / 86400) + 'd ago'
}

export function ChatSidebar({
  agents,
  selectedAgent,
  onSelectAgent,
  wsConnected,
  conversationPreviews,
}: ChatSidebarProps) {
  return (
    <div className="flex h-full w-[260px] shrink-0 flex-col border-r bg-sidebar">
      {/* Header */}
      <div className="flex h-14 items-center justify-between px-4">
        <span className="text-sm font-semibold text-sidebar-foreground">
          Conversations
        </span>
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              'h-2 w-2 rounded-full transition-colors',
              wsConnected
                ? 'bg-[hsl(var(--success))] shadow-[0_0_6px_hsl(var(--success)/0.5)]'
                : 'bg-destructive shadow-[0_0_6px_hsl(var(--destructive)/0.4)]'
            )}
          />
          <span className="text-[11px] text-muted-foreground">
            {wsConnected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Agent list */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {agents.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground/60">
                No agents configured
              </p>
            </div>
          )}

          {agents.map((agent) => {
            const preview = conversationPreviews[agent.id]
            const isActive = selectedAgent === agent.id
            const lastMsg = preview?.lastMessage
            const msgCount = preview?.messageCount ?? 0

            return (
              <button
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className={cn(
                  'group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                  'hover:bg-accent/50',
                  isActive && 'bg-accent/70'
                )}
              >
                {/* Avatar */}
                <div
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg',
                    isActive
                      ? 'bg-primary/20'
                      : 'bg-secondary'
                  )}
                >
                  {agent.emoji || '🤖'}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'truncate text-sm font-medium',
                        isActive
                          ? 'text-foreground'
                          : 'text-foreground/80'
                      )}
                    >
                      {agent.name}
                    </span>
                    {lastMsg && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatRelativeTime(lastMsg.timestamp)}
                      </span>
                    )}
                  </div>

                  {lastMsg ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {lastMsg.role === 'user' ? 'You: ' : ''}
                      {lastMsg.text}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground/50">
                      No messages yet
                    </p>
                  )}

                  {/* Message count badge */}
                  {msgCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="mt-1 h-4 px-1.5 text-[10px] font-normal"
                    >
                      {msgCount} {msgCount === 1 ? 'message' : 'messages'}
                    </Badge>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
