import { useState, useCallback, useRef } from 'react'
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { api } from '@/lib/api'
import {
  Search as SearchIcon, Loader2, Brain, MessageSquare, BookOpen, Bot, Settings
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchResult {
  source: string
  agentId?: string
  title: string
  snippet: string
  matchCount: number
  path?: string
}

interface SearchResponse {
  results: SearchResult[]
  totalResults: number
  query: string
}

interface SearchPageProps {
  onNavigate: (page: string) => void
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SOURCE_CONFIG: Record<string, { icon: typeof Brain; color: string; bg: string; label: string; page?: string }> = {
  memories:      { icon: Brain,          color: 'text-amber-400',  bg: 'bg-amber-500/10',  label: 'Memories',      page: 'agents' },
  conversations: { icon: MessageSquare,  color: 'text-blue-400',   bg: 'bg-blue-500/10',   label: 'Conversations', page: 'chat' },
  skills:        { icon: BookOpen,       color: 'text-purple-400', bg: 'bg-purple-500/10', label: 'Skills',        page: 'skills' },
  agents:        { icon: Bot,            color: 'text-cyan-400',   bg: 'bg-cyan-500/10',   label: 'Agents',        page: 'agents' },
  config:        { icon: Settings,       color: 'text-gray-400',   bg: 'bg-gray-500/10',   label: 'Config',        page: 'config' },
}

const ALL_SOURCES = Object.keys(SOURCE_CONFIG)

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SearchPage({ onNavigate }: SearchPageProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [totalResults, setTotalResults] = useState(0)
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [enabledSources, setEnabledSources] = useState<Set<string>>(new Set(ALL_SOURCES))
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const doSearch = useCallback(async (q: string, sources: Set<string>) => {
    if (!q.trim()) {
      setResults([])
      setTotalResults(0)
      setHasSearched(false)
      return
    }

    setSearching(true)
    setHasSearched(true)
    try {
      const data = await api<SearchResponse>('/search', {
        method: 'POST',
        body: { query: q.trim(), sources: Array.from(sources) },
      })
      setResults(data.results || [])
      setTotalResults(data.totalResults || 0)
    } catch {
      setResults([])
      setTotalResults(0)
    } finally {
      setSearching(false)
    }
  }, [])

  const handleInput = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(value, enabledSources), 300)
  }

  const toggleSource = (source: string) => {
    setEnabledSources(prev => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      // Re-search with updated sources
      if (query.trim()) {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => doSearch(query, next), 300)
      }
      return next
    })
  }

  // Group results by source
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    ;(acc[r.source] ??= []).push(r)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Search</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Search across all agents, memories, conversations, and skills
        </p>
      </div>

      {/* Search input */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={e => handleInput(e.target.value)}
          placeholder="Search everything..."
          className="pl-10 h-11 text-base bg-card border-border"
          autoFocus
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Source filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1">Sources:</span>
        {ALL_SOURCES.map(source => {
          const cfg = SOURCE_CONFIG[source]
          const enabled = enabledSources.has(source)
          return (
            <Button
              key={source}
              size="sm"
              variant={enabled ? "default" : "outline"}
              className={cn(
                "h-6 text-[11px] gap-1",
                enabled && cfg.bg,
                !enabled && "opacity-50"
              )}
              onClick={() => toggleSource(source)}
            >
              <cfg.icon className="h-3 w-3" />
              {cfg.label}
            </Button>
          )
        })}
      </div>

      {/* Results */}
      {!hasSearched ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <SearchIcon className="h-12 w-12 text-muted-foreground/20 mb-4" />
            <p className="text-sm font-medium text-muted-foreground">
              Search across all your agents, memories, conversations, and skills
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1.5">
              Start typing to find anything in your Clade workspace
            </p>
          </CardContent>
        </Card>
      ) : searching ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : results.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <SearchIcon className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              No results found for "{query}"
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Try different keywords or enable more sources
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <p className="text-xs text-muted-foreground">
            {totalResults} result{totalResults !== 1 ? 's' : ''} found
          </p>

          {Object.entries(grouped).map(([source, items]) => {
            const cfg = SOURCE_CONFIG[source] || SOURCE_CONFIG.agents
            const Icon = cfg.icon

            return (
              <div key={source}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={cn("h-4 w-4", cfg.color)} />
                  <h3 className="text-sm font-semibold text-foreground">{cfg.label}</h3>
                  <Badge variant="secondary" className="text-[10px] h-4">{items.length}</Badge>
                </div>
                <div className="space-y-1.5">
                  {items.map((r, idx) => (
                    <Card
                      key={`${source}-${idx}`}
                      className="cursor-pointer hover:bg-secondary/50 transition-colors"
                      onClick={() => cfg.page && onNavigate(cfg.page)}
                    >
                      <CardContent className="p-3 flex items-start gap-3">
                        <div className={cn("mt-0.5 p-1 rounded", cfg.bg)}>
                          <Icon className={cn("h-3 w-3", cfg.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground truncate">
                              {r.title}
                            </span>
                            {r.agentId && (
                              <span className="text-[10px] text-muted-foreground/60 shrink-0">
                                {r.agentId}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 font-mono">
                            {r.snippet}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {r.matchCount} match{r.matchCount !== 1 ? 'es' : ''}
                        </Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
