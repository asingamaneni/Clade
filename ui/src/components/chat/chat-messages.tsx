import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageSquare } from 'lucide-react'

interface ChatAttachment {
  name: string
  type: string
  size: number
  url?: string
  data?: string
  preview?: string | null
}

interface ChatMessage {
  id: string
  agentId: string
  role: 'user' | 'assistant'
  text: string
  timestamp: string
  sessionId?: string
  attachments?: ChatAttachment[]
}

interface ChatMessagesProps {
  messages: ChatMessage[]
  typing: boolean
  agentEmoji?: string
  emptyText?: string
}

// ── Basic markdown rendering ───────────────────────────────────────

function renderMarkdown(text: string): string {
  let html = escapeHtml(text)

  // Code blocks: ```language\ncode\n```
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, lang, code) => {
      const langLabel = lang ? `<span class="text-[10px] text-muted-foreground/60 absolute top-1 right-2 select-none">${lang}</span>` : ''
      return `<div class="relative my-2 rounded-md bg-[hsl(215,14%,11%)] border border-border overflow-x-auto">${langLabel}<pre class="p-3 text-xs leading-relaxed"><code>${code.trim()}</code></pre></div>`
    }
  )

  // Inline code: `code`
  html = html.replace(
    /`([^`\n]+)`/g,
    '<code class="rounded bg-[hsl(215,14%,15%)] px-1.5 py-0.5 text-xs text-[hsl(var(--chart-blue))]">$1</code>'
  )

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
  html = html.replace(/__(.+?)__/g, '<strong class="font-semibold">$1</strong>')

  // Italic: *text* or _text_
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>')

  // Links: [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary underline underline-offset-2 hover:text-primary/80">$1</a>'
  )

  // Line breaks
  html = html.replace(/\n/g, '<br />')

  return html
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr)
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// ── Component ──────────────────────────────────────────────────────

export function ChatMessages({
  messages,
  typing,
  agentEmoji,
  emptyText,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages or typing changes
  useEffect(() => {
    const timer = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 50)
    return () => clearTimeout(timer)
  }, [messages.length, typing])

  if (messages.length === 0 && !typing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
          <MessageSquare className="h-7 w-7 text-muted-foreground/40" />
        </div>
        <p className="max-w-[280px] text-sm text-muted-foreground/60">
          {emptyText || 'No messages yet. Start a conversation!'}
        </p>
      </div>
    )
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1">
      <div className="flex flex-col gap-3 px-4 py-4">
        {messages.map((msg) => {
          const isUser = msg.role === 'user'
          return (
            <div
              key={msg.id}
              className={cn(
                'flex gap-2',
                isUser ? 'justify-end' : 'justify-start'
              )}
            >
              {/* Agent avatar */}
              {!isUser && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-sm mt-0.5">
                  {agentEmoji || '🤖'}
                </div>
              )}

              {/* Bubble */}
              <div
                className={cn(
                  'max-w-[75%] rounded-xl px-3.5 py-2.5',
                  isUser
                    ? 'bg-primary/15 text-foreground rounded-br-sm'
                    : 'bg-card border border-border text-foreground rounded-bl-sm'
                )}
              >
                {/* Attachments */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {msg.attachments.map((att, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 rounded bg-secondary/50 px-2 py-1 text-[11px]"
                      >
                        {att.type?.startsWith('image/') && att.preview ? (
                          <img
                            src={att.preview}
                            alt={att.name}
                            className="h-8 w-8 rounded object-cover"
                          />
                        ) : att.type?.startsWith('image/') && att.url ? (
                          <img
                            src={att.url}
                            alt={att.name}
                            className="h-8 w-8 rounded object-cover"
                          />
                        ) : null}
                        <span className="truncate max-w-[120px] text-muted-foreground">
                          {att.name}
                        </span>
                        <span className="text-muted-foreground/50">
                          {formatBytes(att.size)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Message text */}
                <div
                  className="text-sm leading-relaxed break-words [&_pre]:my-1 [&_code]:break-all"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(msg.text),
                  }}
                />

                {/* Timestamp */}
                <div
                  className={cn(
                    'mt-1 text-[10px]',
                    isUser
                      ? 'text-right text-muted-foreground/40'
                      : 'text-muted-foreground/40'
                  )}
                >
                  {formatTime(msg.timestamp)}
                </div>
              </div>

              {/* User avatar spacer (keeps alignment symmetrical) */}
              {isUser && <div className="w-7 shrink-0" />}
            </div>
          )
        })}

        {/* Typing indicator */}
        {typing && (
          <div className="flex items-start gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-sm">
              {agentEmoji || '🤖'}
            </div>
            <div className="rounded-xl rounded-bl-sm border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-1">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
                  style={{
                    animation: 'typing-bounce 1.4s infinite',
                    animationDelay: '0s',
                  }}
                />
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
                  style={{
                    animation: 'typing-bounce 1.4s infinite',
                    animationDelay: '0.2s',
                  }}
                />
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
                  style={{
                    animation: 'typing-bounce 1.4s infinite',
                    animationDelay: '0.4s',
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
