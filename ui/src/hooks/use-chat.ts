import { useState, useEffect, useRef, useCallback } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface ChatAttachment {
  name: string
  type: string
  size: number
  url?: string
  data?: string
  preview?: string | null
}

export interface ChatMessage {
  id: string
  agentId: string
  role: 'user' | 'assistant'
  text: string
  timestamp: string
  sessionId?: string
  attachments?: ChatAttachment[]
}

export interface Conversation {
  id: string
  agentId: string
  label: string
  messageCount: number
  createdAt: string
  lastActiveAt: string
  lastMessage?: { text: string; role: string; timestamp: string } | null
}

export interface AgentChatData {
  conversations: Record<
    string,
    {
      id: string
      agentId: string
      label: string
      messages: ChatMessage[]
      createdAt: string
      lastActiveAt: string
    }
  >
  order: string[]
}

export interface ConversationPreview {
  messageCount: number
  lastMessage?: { text: string; role: string; timestamp: string } | null
}

export interface UseChatReturn {
  /** Whether the WebSocket is connected to the backend */
  wsConnected: boolean
  /** Map of agentId -> conversations for that agent */
  agentConversations: Record<string, Conversation[]>
  /** Map of agentId -> active conversation ID */
  activeConversationIds: Record<string, string | null>
  /** Messages for the currently-viewed conversation */
  currentMessages: ChatMessage[]
  /** Whether the agent is currently responding */
  typing: boolean
  /** Sidebar preview data per agent */
  conversationPreviews: Record<string, ConversationPreview>
  /** Load (or reload) conversations for an agent */
  loadConversations: (agentId: string) => Promise<void>
  /** Load messages for a specific conversation */
  loadConversationMessages: (agentId: string, convId: string) => Promise<void>
  /** Create a new conversation for an agent */
  createConversation: (agentId: string) => Promise<string | null>
  /** Delete a single conversation */
  deleteConversation: (agentId: string, convId: string) => Promise<void>
  /** Clear all conversations for an agent */
  clearAllConversations: (agentId: string) => Promise<void>
  /** Send a user message */
  sendMessage: (
    agentId: string,
    text: string,
    attachments?: ChatAttachment[],
    conversationId?: string
  ) => Promise<void>
  /** Switch the active conversation tab for an agent */
  switchConversation: (agentId: string, convId: string) => void
  /** Clear the current message list (used when switching agents) */
  clearCurrentMessages: () => void
}

// ═══════════════════════════════════════════════════════════════════════════
// localStorage helpers
// ═══════════════════════════════════════════════════════════════════════════

function localStorageKey(agentId: string): string {
  return `clade-chat-${agentId}`
}

function readLocalData(agentId: string): AgentChatData {
  try {
    const raw = localStorage.getItem(localStorageKey(agentId))
    if (!raw) return { conversations: {}, order: [] }
    const parsed = JSON.parse(raw) as AgentChatData
    if (!parsed.conversations) parsed.conversations = {}
    if (!parsed.order) parsed.order = []
    return parsed
  } catch {
    return { conversations: {}, order: [] }
  }
}

function writeLocalData(agentId: string, data: AgentChatData): void {
  try {
    localStorage.setItem(localStorageKey(agentId), JSON.stringify(data))
  } catch {
    // localStorage may be full -- ignore
  }
}

function generateId(prefix: string): string {
  return (
    prefix +
    '_' +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  )
}

function generateLabel(text: string): string {
  const trimmed = text.trim().replace(/\n/g, ' ')
  if (trimmed.length <= 30) return trimmed
  const cut = trimmed.slice(0, 30)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 15 ? cut.slice(0, lastSpace) : cut) + '...'
}

// ═══════════════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════════════

export function useChat(): UseChatReturn {
  const [wsConnected, setWsConnected] = useState(false)
  const [agentConversations, setAgentConversations] = useState<
    Record<string, Conversation[]>
  >({})
  const [activeConversationIds, setActiveConversationIds] = useState<
    Record<string, string | null>
  >({})
  const [currentMessages, setCurrentMessages] = useState<ChatMessage[]>([])
  const [typing, setTyping] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isBackendAvailableRef = useRef(false)
  const pendingSyncAgentsRef = useRef<Set<string>>(new Set())

  // ── WebSocket lifecycle ──────────────────────────────────────────

  const connectWebSocket = useCallback(() => {
    // Prevent double connections
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.CONNECTING ||
        wsRef.current.readyState === WebSocket.OPEN)
    ) {
      return
    }

    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = window.location.host
      const ws = new WebSocket(`${proto}//${host}/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        if (wsRef.current !== ws) return
        setWsConnected(true)
        isBackendAvailableRef.current = true
        // Clear any pending reconnect
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current)
          reconnectTimerRef.current = null
        }
        // Re-sync any agents that were loaded from localStorage before backend was available
        for (const agentId of pendingSyncAgentsRef.current) {
          fetch(`/api/chat/history?agentId=${encodeURIComponent(agentId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((json) => {
              if (json?.conversations) {
                setAgentConversations((prev) => ({
                  ...prev,
                  [agentId]: json.conversations,
                }))
              }
            })
            .catch(() => {})
        }
        pendingSyncAgentsRef.current.clear()
      }

      ws.onclose = () => {
        // Only update state if this is still the active WebSocket.
        // After HMR or React strict mode remount, the old WS's onclose
        // fires asynchronously and would clobber the new WS reference.
        if (wsRef.current !== ws) return
        setWsConnected(false)
        wsRef.current = null
        // Attempt reconnect after 3s
        if (!reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null
            connectWebSocket()
          }, 3000)
        }
      }

      ws.onerror = () => {
        // Will trigger onclose, which handles reconnect
        ws.close()
      }

      ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string)
          handleWsMessage(data)
        } catch {
          // Ignore malformed messages
        }
      }
    } catch {
      // WebSocket construction failed (e.g. blocked by CSP)
      setWsConnected(false)
      isBackendAvailableRef.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle inbound WS messages ───────────────────────────────────

  // Track streaming message ID so delta events accumulate into one message
  const streamingMsgIdRef = useRef<string | null>(null)

  const handleWsMessage = useCallback(
    (data: Record<string, unknown>) => {
      const type = data.type as string

      if (type === 'connected') {
        // Backend acknowledged us
        return
      }

      if (type === 'message_ack') {
        // Our user message was saved by backend — replace optimistic copy
        const msg = data.message as ChatMessage | undefined
        const convId = data.conversationId as string | undefined
        if (msg && convId) {
          setCurrentMessages((prev) => {
            // Find our optimistic message (same role + similar text) and replace it
            const optimisticIdx = prev.findIndex(
              (m) => m.role === 'user' && m.text === msg.text && m.id !== msg.id
            )
            if (optimisticIdx >= 0) {
              const updated = [...prev]
              updated[optimisticIdx] = msg
              return updated
            }
            // No optimistic match — just add (in case we missed it)
            if (prev.find((m) => m.id === msg.id)) return prev
            return [...prev, msg]
          })
          // Refresh conversation list for this agent
          if (msg.agentId) {
            loadConversations(msg.agentId)
          }
        }
        return
      }

      if (type === 'typing') {
        setTyping(true)
        // Create a streaming placeholder message
        const agentId = data.agentId as string || ''
        const streamId = 'stream_' + Date.now()
        streamingMsgIdRef.current = streamId
        setCurrentMessages((prev) => [
          ...prev,
          {
            id: streamId,
            agentId,
            role: 'assistant' as const,
            text: '',
            timestamp: new Date().toISOString(),
          },
        ])
        return
      }

      if (type === 'delta') {
        // Append streaming text to the current streaming message
        const deltaText = data.text as string
        if (deltaText && streamingMsgIdRef.current) {
          const streamId = streamingMsgIdRef.current
          setCurrentMessages((prev) =>
            prev.map((m) =>
              m.id === streamId ? { ...m, text: m.text + deltaText } : m
            )
          )
        }
        return
      }

      if (type === 'message') {
        setTyping(false)
        const msg = data.message as ChatMessage | undefined
        if (msg) {
          // Replace the streaming placeholder with the final message
          const streamId = streamingMsgIdRef.current
          streamingMsgIdRef.current = null
          setCurrentMessages((prev) => {
            if (streamId) {
              // Replace the streaming message with the final one
              return prev.map((m) => (m.id === streamId ? msg : m))
            }
            if (prev.find((m) => m.id === msg.id)) return prev
            return [...prev, msg]
          })
          // Refresh conversation list for updated lastMessage
          if (msg.agentId) {
            loadConversations(msg.agentId)
          }
        }
        return
      }

      if (type === 'error') {
        setTyping(false)
        // Remove streaming placeholder if present
        const streamId = streamingMsgIdRef.current
        streamingMsgIdRef.current = null
        // Surface error as a system message
        const errorText = (data.text as string) || 'Unknown error'
        const errorMsg: ChatMessage = {
          id: generateId('err'),
          agentId: '',
          role: 'assistant',
          text: `**Error:** ${errorText}`,
          timestamp: new Date().toISOString(),
        }
        setCurrentMessages((prev) => {
          const filtered = streamId ? prev.filter((m) => m.id !== streamId) : prev
          return [...filtered, errorMsg]
        })
        return
      }
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // ── Connect on mount, cleanup on unmount ─────────────────────────

  useEffect(() => {
    connectWebSocket()
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connectWebSocket])

  // ── API / localStorage methods ───────────────────────────────────

  const loadConversations = useCallback(
    async (agentId: string): Promise<void> => {
      if (isBackendAvailableRef.current) {
        try {
          const resp = await fetch(
            `/api/chat/history?agentId=${encodeURIComponent(agentId)}`
          )
          if (!resp.ok) throw new Error('HTTP ' + resp.status)
          const json = (await resp.json()) as {
            conversations?: Conversation[]
          }
          const convs = json.conversations || []
          setAgentConversations((prev) => ({ ...prev, [agentId]: convs }))
          return
        } catch {
          // Fall through to localStorage
        }
      }

      // localStorage fallback — mark agent for re-sync when backend connects
      pendingSyncAgentsRef.current.add(agentId)
      const data = readLocalData(agentId)
      const convs: Conversation[] = data.order
        .map((id) => {
          const c = data.conversations[id]
          if (!c) return null
          const msgs = c.messages || []
          const lastMsg =
            msgs.length > 0
              ? {
                  text: msgs[msgs.length - 1].text.slice(0, 100),
                  role: msgs[msgs.length - 1].role,
                  timestamp: msgs[msgs.length - 1].timestamp,
                }
              : null
          return {
            id: c.id,
            agentId: c.agentId,
            label: c.label,
            messageCount: msgs.length,
            createdAt: c.createdAt,
            lastActiveAt: c.lastActiveAt,
            lastMessage: lastMsg,
          } satisfies Conversation
        })
        .filter(Boolean) as Conversation[]

      setAgentConversations((prev) => ({ ...prev, [agentId]: convs }))
    },
    []
  )

  const loadConversationMessages = useCallback(
    async (agentId: string, convId: string): Promise<void> => {
      if (isBackendAvailableRef.current) {
        try {
          const resp = await fetch(
            `/api/chat/history?agentId=${encodeURIComponent(agentId)}&conversationId=${encodeURIComponent(convId)}`
          )
          if (resp.status === 404) {
            // Conversation doesn't exist on server — show empty
            setCurrentMessages([])
            return
          }
          if (!resp.ok) throw new Error('HTTP ' + resp.status)
          const json = (await resp.json()) as { messages?: ChatMessage[] }
          setCurrentMessages(json.messages || [])
          return
        } catch {
          // Fall through to localStorage
        }
      }

      // localStorage fallback
      const data = readLocalData(agentId)
      const conv = data.conversations[convId]
      setCurrentMessages(conv ? conv.messages || [] : [])
    },
    []
  )

  const createConversation = useCallback(
    async (agentId: string): Promise<string | null> => {
      if (isBackendAvailableRef.current) {
        try {
          const resp = await fetch('/api/chat/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId }),
          })
          if (!resp.ok) throw new Error('HTTP ' + resp.status)
          const json = (await resp.json()) as {
            conversation?: { id: string }
          }
          const newId = json.conversation?.id ?? null
          if (newId) {
            await loadConversations(agentId)
            setActiveConversationIds((prev) => ({
              ...prev,
              [agentId]: newId,
            }))
            setCurrentMessages([])
          }
          return newId
        } catch {
          // Fall through to localStorage
        }
      }

      // localStorage fallback
      const data = readLocalData(agentId)
      const convId = generateId('conv')
      const now = new Date().toISOString()
      data.conversations[convId] = {
        id: convId,
        agentId,
        label: 'New chat',
        messages: [],
        createdAt: now,
        lastActiveAt: now,
      }
      data.order = [convId, ...data.order]
      writeLocalData(agentId, data)
      await loadConversations(agentId)
      setActiveConversationIds((prev) => ({ ...prev, [agentId]: convId }))
      setCurrentMessages([])
      return convId
    },
    [loadConversations]
  )

  const deleteConversation = useCallback(
    async (agentId: string, convId: string): Promise<void> => {
      if (isBackendAvailableRef.current) {
        try {
          await fetch(
            `/api/chat/conversations/${encodeURIComponent(convId)}?agentId=${encodeURIComponent(agentId)}`,
            { method: 'DELETE' }
          )
        } catch {
          // Continue anyway -- clear local state
        }
      } else {
        const data = readLocalData(agentId)
        delete data.conversations[convId]
        data.order = data.order.filter((id) => id !== convId)
        writeLocalData(agentId, data)
      }

      // Update local state
      setAgentConversations((prev) => {
        const list = (prev[agentId] || []).filter((c) => c.id !== convId)
        return { ...prev, [agentId]: list }
      })

      // If the deleted conversation was active, switch to the next one
      setActiveConversationIds((prev) => {
        if (prev[agentId] !== convId) return prev
        const remaining = (agentConversations[agentId] || []).filter(
          (c) => c.id !== convId
        )
        const nextId = remaining.length > 0 ? remaining[0].id : null
        if (nextId) {
          loadConversationMessages(agentId, nextId)
        } else {
          setCurrentMessages([])
        }
        return { ...prev, [agentId]: nextId }
      })
    },
    [agentConversations, loadConversationMessages]
  )

  const clearAllConversations = useCallback(
    async (agentId: string): Promise<void> => {
      if (isBackendAvailableRef.current) {
        try {
          await fetch(
            `/api/chat/conversations?agentId=${encodeURIComponent(agentId)}`,
            { method: 'DELETE' }
          )
        } catch {
          // Continue anyway
        }
      } else {
        writeLocalData(agentId, { conversations: {}, order: [] })
      }

      setAgentConversations((prev) => ({ ...prev, [agentId]: [] }))
      setActiveConversationIds((prev) => ({ ...prev, [agentId]: null }))
      setCurrentMessages([])
    },
    []
  )

  const sendMessage = useCallback(
    async (
      agentId: string,
      text: string,
      attachments?: ChatAttachment[],
      conversationId?: string
    ): Promise<void> => {
      const activeConvId = conversationId ?? activeConversationIds[agentId]

      // If sending via WebSocket
      if (
        wsConnected &&
        wsRef.current &&
        wsRef.current.readyState === WebSocket.OPEN
      ) {
        const payload: Record<string, unknown> = {
          type: 'message',
          agentId,
          text,
          conversationId: activeConvId || '',
        }
        if (attachments && attachments.length > 0) {
          payload.attachments = attachments.map((a) => ({
            name: a.name,
            type: a.type,
            size: a.size,
            data: a.data || '',
          }))
        }
        wsRef.current.send(JSON.stringify(payload))

        // Optimistically add user message to the view
        const userMsg: ChatMessage = {
          id: generateId('msg'),
          agentId,
          role: 'user',
          text,
          timestamp: new Date().toISOString(),
          ...(attachments && attachments.length > 0
            ? {
                attachments: attachments.map((a) => ({
                  name: a.name,
                  type: a.type,
                  size: a.size,
                  url: a.url,
                  preview: a.preview,
                })),
              }
            : {}),
        }
        setCurrentMessages((prev) => [...prev, userMsg])
        setTyping(true)
        return
      }

      // localStorage-only mode: store the message locally
      let convId = activeConvId
      if (!convId) {
        convId = await createConversation(agentId)
        if (!convId) return
      }

      const data = readLocalData(agentId)
      const conv = data.conversations[convId]
      if (!conv) return

      const userMsg: ChatMessage = {
        id: generateId('msg'),
        agentId,
        role: 'user',
        text,
        timestamp: new Date().toISOString(),
        ...(attachments && attachments.length > 0
          ? {
              attachments: attachments.map((a) => ({
                name: a.name,
                type: a.type,
                size: a.size,
                preview: a.preview,
              })),
            }
          : {}),
      }
      conv.messages.push(userMsg)
      conv.lastActiveAt = userMsg.timestamp
      if (conv.label === 'New chat') {
        conv.label = generateLabel(text)
      }
      data.order = [convId, ...data.order.filter((id) => id !== convId)]
      writeLocalData(agentId, data)

      setCurrentMessages((prev) => [...prev, userMsg])
      await loadConversations(agentId)
    },
    [wsConnected, activeConversationIds, createConversation, loadConversations]
  )

  const switchConversation = useCallback(
    (agentId: string, convId: string) => {
      setActiveConversationIds((prev) => ({ ...prev, [agentId]: convId }))
      setTyping(false)
      loadConversationMessages(agentId, convId)
    },
    [loadConversationMessages]
  )

  const clearCurrentMessages = useCallback(() => {
    setCurrentMessages([])
    setTyping(false)
  }, [])

  // ── Derived: sidebar previews ────────────────────────────────────

  const conversationPreviews: Record<string, ConversationPreview> = {}
  for (const [agentId, convs] of Object.entries(agentConversations)) {
    const totalMessages = convs.reduce(
      (sum, c) => sum + (c.messageCount || 0),
      0
    )
    // Use the active conversation's last message for the preview
    const activeId = activeConversationIds[agentId]
    const active = activeId ? convs.find((c) => c.id === activeId) : convs[0]
    const mostRecent = active || (convs.length > 0 ? convs[0] : null)
    conversationPreviews[agentId] = {
      messageCount: totalMessages,
      lastMessage: mostRecent?.lastMessage ?? null,
    }
  }

  return {
    wsConnected,
    agentConversations,
    activeConversationIds,
    currentMessages,
    typing,
    conversationPreviews,
    loadConversations,
    loadConversationMessages,
    createConversation,
    deleteConversation,
    clearAllConversations,
    sendMessage,
    switchConversation,
    clearCurrentMessages,
  }
}
