import { useState, useEffect, useCallback, useRef } from 'react'
import { Sidebar } from '@/components/layout/sidebar'
import { TopBar } from '@/components/layout/topbar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, healthApi } from '@/lib/api'

// Lazy page imports
import { DashboardPage } from '@/pages/dashboard'
import { ChatPage } from '@/pages/chat'
import { AgentsPage } from '@/pages/agents'
import { SessionsPage } from '@/pages/sessions'
import { McpPage } from '@/pages/mcp'
import { SkillsPage } from '@/pages/skills'
import { ChannelsPage } from '@/pages/channels'
import { CronPage } from '@/pages/cron'
import { ConfigPage } from '@/pages/config'
import { UserProfilePage } from '@/pages/user'
import { WelcomePage, OnboardingPage } from '@/pages/welcome'

// ── Types ──────────────────────────────────────────────────────

export interface Agent {
  id: string
  name: string
  description?: string
  model?: string
  toolPreset?: string
  emoji?: string
  customTools?: string[]
  mcp?: string[]
  skills?: string[]
}

export interface Session {
  id: string
  agentId?: string
  agent_id?: string
  channel?: string
  status: string
  lastActiveAt?: string
  label?: string
  messageCount?: number
}

export interface McpServer {
  name: string
  status: 'pending' | 'active' | 'disabled'
  description?: string
}

export interface Skill {
  name: string
  status: 'pending' | 'active' | 'disabled'
  description?: string
  content?: string
  assignedAgents?: string[]
  assigned_agents?: string[]
}

export interface CronJob {
  id: string
  name: string
  schedule: string
  agentId?: string
  agent_id?: string
  prompt?: string
  enabled: boolean
  lastRun?: string
  last_run_at?: string
}

export interface Channel {
  name: string
  connected: boolean
}

// ── Toast System ───────────────────────────────────────────────

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

let toastId = 0
let globalSetToasts: React.Dispatch<React.SetStateAction<Toast[]>> | null = null

export function showToast(message: string, type: Toast['type'] = 'info') {
  if (!globalSetToasts) return
  const id = ++toastId
  globalSetToasts(prev => [...prev, { id, message, type }])
  setTimeout(() => {
    globalSetToasts?.(prev => prev.filter(t => t.id !== id))
  }, 3200)
}

function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])
  globalSetToasts = setToasts

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`pointer-events-auto px-5 py-3 rounded-lg text-sm font-medium animate-in slide-in-from-right-5 ${
            t.type === 'success'
              ? 'bg-green-500/15 border border-green-500/30 text-green-400'
              : t.type === 'error'
              ? 'bg-red-500/15 border border-red-500/30 text-red-400'
              : 'bg-blue-500/15 border border-blue-500/30 text-blue-400'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}

// ── App Component ──────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [connected, setConnected] = useState(false)
  const [health, setHealth] = useState<any>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [cronJobs, setCronJobs] = useState<CronJob[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [initialLoaded, setInitialLoaded] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  // ── Fetch helpers ──────────────────────────────────────────
  const fetchAgents = useCallback(() => {
    api<{ agents: Agent[] }>('/agents').then(d => setAgents(d.agents || [])).catch(() => {})
  }, [])

  const fetchSessions = useCallback(() => {
    api<{ sessions: Session[] }>('/sessions').then(d => setSessions(d.sessions || [])).catch(() => {})
  }, [])

  const fetchMcp = useCallback(() => {
    api<{ mcpServers: McpServer[] }>('/mcp').then(d => setMcpServers(d.mcpServers || [])).catch(() => {})
  }, [])

  const fetchSkills = useCallback(() => {
    api<{ skills: Skill[] }>('/skills').then(d => setSkills(d.skills || [])).catch(() => {})
  }, [])

  const fetchCron = useCallback(() => {
    api<{ jobs: CronJob[] }>('/cron').then(d => setCronJobs(d.jobs || [])).catch(() => {})
  }, [])

  const fetchChannels = useCallback(() => {
    api<{ channels: Channel[] }>('/channels').then(d => setChannels(d.channels || [])).catch(() => {})
  }, [])

  const fetchHealth = useCallback(() => {
    healthApi().then(h => { if (h) setHealth(h) })
  }, [])

  const fetchAll = useCallback(() => {
    return Promise.allSettled([
      fetchHealth(), fetchAgents(), fetchSessions(),
      fetchMcp(), fetchSkills(), fetchCron(), fetchChannels(),
    ])
  }, [fetchHealth, fetchAgents, fetchSessions, fetchMcp, fetchSkills, fetchCron, fetchChannels])

  // ── WebSocket for admin real-time updates ──────────────────
  useEffect(() => {
    let ws: WebSocket
    let reconTimer: ReturnType<typeof setTimeout>

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${proto}//${location.host}/ws/admin`)
      wsRef.current = ws

      ws.onopen = () => {
        if (wsRef.current !== ws) return
        setConnected(true)
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'snapshot') {
            fetchAll()
          } else if (msg.type) {
            const domain = msg.type.split(':')[0]
            if (domain === 'agent' || domain === 'memory') fetchAgents()
            else if (domain === 'session') fetchSessions()
            else if (domain === 'mcp') fetchMcp()
            else if (domain === 'skill') fetchSkills()
            else if (domain === 'cron') fetchCron()
            else if (domain === 'channel' || domain === 'webchat') fetchChannels()
            else if (domain === 'config') fetchAll()
          }
        } catch {}
      }

      ws.onclose = () => {
        if (wsRef.current !== ws) return
        setConnected(false)
        wsRef.current = null
        reconTimer = setTimeout(connect, 3000)
      }

      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      clearTimeout(reconTimer)
      if (ws) ws.close()
    }
  }, [fetchAll, fetchAgents, fetchSessions, fetchMcp, fetchSkills, fetchCron, fetchChannels])

  // ── Initial load ───────────────────────────────────────────
  useEffect(() => { fetchAll().finally(() => setInitialLoaded(true)) }, [])

  // ── Periodic health refresh ────────────────────────────────
  useEffect(() => {
    const t = setInterval(fetchHealth, 15000)
    return () => clearInterval(t)
  }, [fetchHealth])

  // ── Navigation helpers ─────────────────────────────────────
  const navigateToAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId)
    setPage('agents')
  }, [])

  // ── Page renderer ──────────────────────────────────────────
  const renderPage = () => {
    // Don't render any page until we know if agents exist
    if (!initialLoaded) return null

    // Show welcome/onboarding when no agents exist
    if (agents.length === 0 && (page === 'dashboard' || page === 'agents')) {
      if (showTemplatePicker) {
        return <WelcomePage onCreated={fetchAll} />
      }
      return (
        <OnboardingPage
          onCreated={() => { fetchAll().then(() => setPage('chat')) }}
          onPickTemplate={() => setShowTemplatePicker(true)}
        />
      )
    }

    switch (page) {
      case 'dashboard':
        return (
          <DashboardPage
            health={health}
            agents={agents}
            sessions={sessions}
            cronJobs={cronJobs}
            onNavigateToAgent={navigateToAgent}
          />
        )
      case 'chat':
        return <ChatPage agents={agents} />
      case 'agents':
        return (
          <AgentsPage
            agents={agents}
            onRefresh={fetchAgents}
            initialSelectedId={selectedAgentId}
            onAgentDeleted={() => { setSelectedAgentId(null); fetchAll() }}
          />
        )
      case 'user':
        return <UserProfilePage />
      case 'sessions':
        return <SessionsPage sessions={sessions} onRefresh={fetchSessions} />
      case 'mcp':
        return <McpPage mcpServers={mcpServers} onRefresh={fetchMcp} />
      case 'skills':
        return <SkillsPage skills={skills} agents={agents} onRefresh={fetchSkills} />
      case 'channels':
        return <ChannelsPage channels={channels} onRefresh={fetchChannels} />
      case 'cron':
        return (
          <CronPage
            cronJobs={cronJobs}
            agents={agents}
            onRefresh={() => { fetchCron(); fetchAgents() }}
          />
        )
      case 'config':
        return <ConfigPage />
      default:
        return (
          <DashboardPage
            health={health}
            agents={agents}
            sessions={sessions}
            cronJobs={cronJobs}
            onNavigateToAgent={navigateToAgent}
          />
        )
    }
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background">
        <Sidebar
          page={page}
          onPageChange={setPage}
          agents={agents}
          onNavigateToAgent={navigateToAgent}
        />
        <div className="flex flex-col flex-1 min-w-0">
          <TopBar connected={connected} health={health} agentCount={agents.length} />
          <main className="flex-1 overflow-y-auto bg-background p-6">
            {renderPage()}
          </main>
        </div>
        <ToastContainer />
      </div>
    </TooltipProvider>
  )
}
