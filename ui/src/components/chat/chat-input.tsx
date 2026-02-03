import { useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ArrowUp, Paperclip, X } from 'lucide-react'

interface ChatAttachment {
  name: string
  type: string
  size: number
  url?: string
  data?: string
  preview?: string | null
}

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  disabled?: boolean
  wsConnected: boolean
  pendingAttachments: ChatAttachment[]
  onAttach: (files: FileList) => void
  onRemoveAttachment: (name: string) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
  wsConnected,
  pendingAttachments,
  onAttach,
  onRemoveAttachment,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    // Clamp between 1 row (~24px) and 5 rows (~120px)
    const maxHeight = 120
    ta.style.height = Math.min(ta.scrollHeight, maxHeight) + 'px'
    ta.style.overflowY = ta.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    adjustHeight()
  }, [value, adjustHeight])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (value.trim() && !disabled) {
          onSend()
        }
      }
    },
    [value, disabled, onSend]
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        onAttach(e.target.files)
        // Reset file input so same file can be selected again
        e.target.value = ''
      }
    },
    [onAttach]
  )

  const canSend = value.trim().length > 0 && !disabled

  return (
    <div className="border-t bg-card/30">
      {/* Pending attachments preview */}
      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {pendingAttachments.map((att) => (
            <div
              key={att.name}
              className="group flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5"
            >
              {att.type?.startsWith('image/') && att.preview ? (
                <img
                  src={att.preview}
                  alt={att.name}
                  className="h-8 w-8 rounded object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded bg-secondary text-xs text-muted-foreground">
                  {att.name.split('.').pop()?.toUpperCase() || 'FILE'}
                </div>
              )}
              <div className="flex flex-col">
                <span className="max-w-[120px] truncate text-xs text-foreground/80">
                  {att.name}
                </span>
                <span className="text-[10px] text-muted-foreground/60">
                  {formatBytes(att.size)}
                </span>
              </div>
              <button
                className="ml-1 flex h-5 w-5 items-center justify-center rounded-full hover:bg-destructive/20 hover:text-destructive transition-colors"
                onClick={() => onRemoveAttachment(att.name)}
                title="Remove attachment"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2 p-3">
        {/* Attach button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          title="Attach files"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Textarea */}
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              wsConnected
                ? 'Send a message...'
                : 'Backend not connected. Messages saved locally.'
            }
            disabled={disabled}
            rows={1}
            className={cn(
              'w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm',
              'ring-offset-background placeholder:text-muted-foreground/50',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'scrollbar-thin'
            )}
            style={{ minHeight: '36px', maxHeight: '120px', overflowY: 'hidden' }}
          />
        </div>

        {/* Send button */}
        <Button
          size="icon"
          className={cn(
            'h-9 w-9 shrink-0 rounded-full transition-colors',
            canSend
              ? 'bg-[hsl(var(--success))] text-white hover:bg-[hsl(var(--success))]/80'
              : 'bg-secondary text-muted-foreground cursor-default'
          )}
          onClick={() => {
            if (canSend) onSend()
          }}
          disabled={!canSend}
          title="Send message"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>

      {/* Offline indicator */}
      {!wsConnected && (
        <div className="px-4 pb-2">
          <p className="text-[10px] text-warning">
            Backend not connected. Messages will be stored locally only.
          </p>
        </div>
      )}
    </div>
  )
}
