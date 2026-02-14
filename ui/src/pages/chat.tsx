import { useState, useCallback, useEffect, useMemo } from 'react'
import { ChatSidebar } from '@/components/chat/chat-sidebar'
import { ChatTabs } from '@/components/chat/chat-tabs'
import { ChatMessages } from '@/components/chat/chat-messages'
import { ChatInput } from '@/components/chat/chat-input'
import { useChat } from '@/hooks/use-chat'
import type { ChatAttachment } from '@/hooks/use-chat'
import { Badge } from '@/components/ui/badge'
import { Bot, Cpu, Wrench } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface Agent {
  id: string
  name: string
  description?: string
  model?: string
  toolPreset?: string
  emoji?: string
}

interface ChatPageProps {
  agents: Agent[]
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatRelativeTime(isoStr: string): string {
  if (!isoStr) return ''
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
  return Math.floor(diff / 86400) + 'd ago'
}

function fileToAttachment(file: File): Promise<ChatAttachment> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1] || ''
      let preview: string | null = null
      if (file.type.startsWith('image/')) {
        preview = reader.result as string
      }
      resolve({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        data: base64,
        preview,
      })
    }
    reader.onerror = () => {
      resolve({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
      })
    }
    reader.readAsDataURL(file)
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

export function ChatPage({ agents }: ChatPageProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<
    ChatAttachment[]
  >([])

  const {
    wsConnected,
    agentConversations,
    activeConversationIds,
    currentMessages,
    typing,
    activitySteps,
    conversationPreviews,
    loadConversations,
    loadConversationMessages,
    createConversation,
    deleteConversation,
    clearAllConversations,
    sendMessage,
    switchConversation,
    clearCurrentMessages,
  } = useChat()

  // ── Derived state ────────────────────────────────────────────────

  const selectedAgentData = useMemo(
    () => agents.find((a) => a.id === selectedAgent) ?? null,
    [agents, selectedAgent]
  )

  const currentConversations = useMemo(
    () => (selectedAgent ? agentConversations[selectedAgent] || [] : []),
    [selectedAgent, agentConversations]
  )

  const activeConvId = selectedAgent
    ? activeConversationIds[selectedAgent] ?? null
    : null

  // ── Select agent and load conversations ──────────────────────────

  const handleSelectAgent = useCallback(
    async (agentId: string) => {
      setSelectedAgent(agentId)
      setInputValue('')
      setPendingAttachments([])
      clearCurrentMessages()
      await loadConversations(agentId)
      // If this agent already had an active conversation, reload its messages
      const existingActiveId = activeConversationIds[agentId]
      if (existingActiveId) {
        loadConversationMessages(agentId, existingActiveId)
      }
    },
    [loadConversations, clearCurrentMessages, activeConversationIds, loadConversationMessages]
  )

  // When conversations load, auto-select the first one if none active
  useEffect(() => {
    if (!selectedAgent) return
    const convs = agentConversations[selectedAgent]
    const currentActive = activeConversationIds[selectedAgent]
    if (convs && convs.length > 0 && !currentActive) {
      switchConversation(selectedAgent, convs[0].id)
    }
  }, [
    selectedAgent,
    agentConversations,
    activeConversationIds,
    switchConversation,
  ])

  // Auto-select first agent if none selected
  useEffect(() => {
    if (!selectedAgent && agents.length > 0) {
      handleSelectAgent(agents[0].id)
    }
  }, [agents, selectedAgent, handleSelectAgent])

  // ── Handlers ─────────────────────────────────────────────────────

  const handleSwitchTab = useCallback(
    (convId: string) => {
      if (!selectedAgent) return
      switchConversation(selectedAgent, convId)
    },
    [selectedAgent, switchConversation]
  )

  const handleNewConversation = useCallback(async () => {
    if (!selectedAgent) return
    await createConversation(selectedAgent)
  }, [selectedAgent, createConversation])

  const handleCloseTab = useCallback(
    async (convId: string) => {
      if (!selectedAgent) return
      await deleteConversation(selectedAgent, convId)
    },
    [selectedAgent, deleteConversation]
  )

  const handleClearAll = useCallback(async () => {
    if (!selectedAgent) return
    await clearAllConversations(selectedAgent)
  }, [selectedAgent, clearAllConversations])

  const handleSend = useCallback(async () => {
    if (!selectedAgent || !inputValue.trim()) return

    const text = inputValue.trim()
    const attachments =
      pendingAttachments.length > 0 ? [...pendingAttachments] : undefined

    setInputValue('')
    setPendingAttachments([])

    // If no active conversation, create one first
    let convId = activeConversationIds[selectedAgent]
    if (!convId) {
      convId = await createConversation(selectedAgent)
    }

    await sendMessage(selectedAgent, text, attachments, convId || undefined)
  }, [
    selectedAgent,
    inputValue,
    pendingAttachments,
    activeConversationIds,
    createConversation,
    sendMessage,
  ])

  const handleAttach = useCallback(async (files: FileList) => {
    const newAttachments: ChatAttachment[] = []
    for (let i = 0; i < files.length; i++) {
      const att = await fileToAttachment(files[i])
      newAttachments.push(att)
    }
    setPendingAttachments((prev) => [...prev, ...newAttachments])
  }, [])

  const handleRemoveAttachment = useCallback((name: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.name !== name))
  }, [])

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar: agent list */}
      <ChatSidebar
        agents={agents}
        selectedAgent={selectedAgent}
        onSelectAgent={handleSelectAgent}
        wsConnected={wsConnected}
        conversationPreviews={conversationPreviews}
      />

      {/* Right panel: chat area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {selectedAgentData ? (
          <>
            {/* Agent header */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-base">
                  {selectedAgentData.emoji || '🤖'}
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {selectedAgentData.name}
                  </h2>
                  {selectedAgentData.description && (
                    <p className="text-[11px] text-muted-foreground truncate max-w-[300px]">
                      {selectedAgentData.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedAgentData.model && (
                  <Badge
                    variant="outline"
                    className="gap-1 text-[11px] font-normal text-muted-foreground"
                  >
                    <Cpu className="h-3 w-3" />
                    {selectedAgentData.model}
                  </Badge>
                )}
                {selectedAgentData.toolPreset && (
                  <Badge
                    variant="secondary"
                    className="gap-1 text-[11px] font-normal"
                  >
                    <Wrench className="h-3 w-3" />
                    {selectedAgentData.toolPreset}
                  </Badge>
                )}
              </div>
            </div>

            {/* Conversation tabs */}
            <ChatTabs
              conversations={currentConversations}
              activeConvId={activeConvId}
              onSwitchTab={handleSwitchTab}
              onNewConversation={handleNewConversation}
              onCloseTab={handleCloseTab}
              onClearAll={handleClearAll}
            />

            {/* Messages area */}
            <ChatMessages
              messages={currentMessages}
              typing={typing}
              agentEmoji={selectedAgentData.emoji}
              activitySteps={activitySteps}
              emptyText={
                activeConvId
                  ? `Start chatting with ${selectedAgentData.name}!`
                  : 'Create a new conversation to get started.'
              }
            />

            {/* Input area */}
            <ChatInput
              value={inputValue}
              onChange={setInputValue}
              onSend={handleSend}
              disabled={!activeConvId}
              wsConnected={wsConnected}
              pendingAttachments={pendingAttachments}
              onAttach={handleAttach}
              onRemoveAttachment={handleRemoveAttachment}
            />
          </>
        ) : (
          /* Empty state when no agent selected */
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-secondary">
              <Bot className="h-10 w-10 text-muted-foreground/30" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground/80">
                Select an agent to chat
              </h2>
              <p className="mt-1 max-w-[300px] text-sm text-muted-foreground/60">
                {agents.length === 0
                  ? 'No agents configured. Create an agent first from the Agents page.'
                  : 'Choose an agent from the sidebar to start a conversation.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
