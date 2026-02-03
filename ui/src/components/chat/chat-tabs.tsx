import { useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Plus, X, Trash2 } from 'lucide-react'

interface Conversation {
  id: string
  agentId: string
  label: string
  messageCount: number
  createdAt: string
  lastActiveAt: string
  lastMessage?: { text: string; role: string; timestamp: string } | null
}

interface ChatTabsProps {
  conversations: Conversation[]
  activeConvId: string | null
  onSwitchTab: (convId: string) => void
  onNewConversation: () => void
  onCloseTab: (convId: string) => void
  onClearAll: () => void
}

export function ChatTabs({
  conversations,
  activeConvId,
  onSwitchTab,
  onNewConversation,
  onCloseTab,
  onClearAll,
}: ChatTabsProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to active tab
  useEffect(() => {
    if (!activeConvId || !scrollContainerRef.current) return
    const activeEl = scrollContainerRef.current.querySelector(
      `[data-conv-id="${activeConvId}"]`
    )
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [activeConvId])

  return (
    <div className="flex h-10 items-center gap-1 border-b bg-card/50 px-2">
      {/* Scrollable tab area */}
      <div
        ref={scrollContainerRef}
        className="flex flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: 'none' }}
      >
        {conversations.map((conv) => {
          const isActive = conv.id === activeConvId
          const truncatedLabel =
            conv.label.length > 20
              ? conv.label.slice(0, 20) + '...'
              : conv.label

          return (
            <div
              key={conv.id}
              data-conv-id={conv.id}
              className={cn(
                'group relative flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors cursor-pointer',
                'hover:bg-accent/50',
                isActive
                  ? 'bg-accent/60 text-foreground'
                  : 'text-muted-foreground'
              )}
              onClick={() => onSwitchTab(conv.id)}
            >
              {/* Tab label */}
              <span className="truncate max-w-[140px]">
                {truncatedLabel || 'New chat'}
              </span>

              {/* Close button - visible on hover or when active */}
              <button
                className={cn(
                  'ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-opacity',
                  'hover:bg-destructive/20 hover:text-destructive',
                  isActive
                    ? 'opacity-60 hover:opacity-100'
                    : 'opacity-0 group-hover:opacity-60 group-hover:hover:opacity-100'
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(conv.id)
                }}
                title="Close conversation"
              >
                <X className="h-3 w-3" />
              </button>

              {/* Active indicator */}
              {isActive && (
                <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-primary" />
              )}
            </div>
          )
        })}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5 border-l pl-1.5 ml-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onNewConversation}
          title="New conversation"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        {conversations.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onClearAll}
            title="Clear all conversations"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
