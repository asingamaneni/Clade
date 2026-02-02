import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs';

import { MemoryStore } from './store.js';
import {
  appendToDailyLog,
  appendToLongTermMemory,
  readMemoryFile,
} from './daily-log.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const agentId = process.env['TEAMAGENTS_AGENT_ID'] ?? 'default';
const baseDir =
  process.env['TEAMAGENTS_HOME'] ?? join(homedir(), '.teamagents');

const agentDir = join(baseDir, 'agents', agentId);
mkdirSync(join(agentDir, 'memory'), { recursive: true });

// ---------------------------------------------------------------------------
// FTS5 store -- kept in the agent's directory
// ---------------------------------------------------------------------------

const dbPath = join(agentDir, 'memory.db');
const store = new MemoryStore(dbPath);

// Initial indexing of all existing markdown files
store.reindexAll(agentDir);

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'teamagents-memory',
  version: '0.1.0',
});

// ---------------------------------------------------------------------------
// Tool: memory_store
// ---------------------------------------------------------------------------

server.tool(
  'memory_store',
  'Store a memory entry. Appends to the daily log or long-term MEMORY.md.',
  {
    content: z.string().describe('The memory content to store'),
    target: z
      .enum(['daily', 'longterm'])
      .default('daily')
      .describe(
        'Where to store: "daily" for today\'s log, "longterm" for MEMORY.md',
      ),
  },
  async ({ content, target }) => {
    try {
      if (target === 'longterm') {
        appendToLongTermMemory(agentDir, content);

        // Re-index the updated file
        const memPath = join(agentDir, 'MEMORY.md');
        if (existsSync(memPath)) {
          const fileContent = readFileSync(memPath, 'utf-8');
          store.indexFile('MEMORY.md', fileContent);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: 'Stored to long-term memory (MEMORY.md).',
            },
          ],
        };
      } else {
        appendToDailyLog(agentDir, content);

        // Re-index the updated daily log
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const dailyFile = `memory/${yyyy}-${mm}-${dd}.md`;
        const dailyPath = join(agentDir, dailyFile);
        if (existsSync(dailyPath)) {
          const fileContent = readFileSync(dailyPath, 'utf-8');
          store.indexFile(dailyFile, fileContent);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Stored to daily log (${dailyFile}).`,
            },
          ],
        };
      }
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error storing memory: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: memory_search
// ---------------------------------------------------------------------------

server.tool(
  'memory_search',
  'Search across all memory files using full-text search.',
  {
    query: z.string().describe('Search query'),
    limit: z.number().default(10).describe('Maximum number of results'),
  },
  async ({ query, limit }) => {
    try {
      // Re-index before searching to catch any external changes
      store.reindexAll(agentDir);

      const results = store.search(query, limit);

      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No results found.',
            },
          ],
        };
      }

      const formatted = results.map((r, i) => {
        const snippet =
          r.chunkText.length > 300
            ? r.chunkText.slice(0, 300) + '...'
            : r.chunkText;
        return [
          `### Result ${i + 1}`,
          `- **File:** ${r.filePath}`,
          `- **Lines:** ${r.chunkStart}-${r.chunkEnd} (char offset)`,
          `- **Relevance:** ${r.rank.toFixed(4)}`,
          '',
          snippet,
        ].join('\n');
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: formatted.join('\n\n---\n\n'),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error searching memory: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: memory_get
// ---------------------------------------------------------------------------

server.tool(
  'memory_get',
  'Read a specific memory file.',
  {
    file: z
      .string()
      .describe(
        'Relative path within agent directory, e.g. "MEMORY.md" or "memory/2026-02-01.md"',
      ),
    offset: z
      .number()
      .optional()
      .describe('Line offset (0-based) to start reading from'),
    limit: z
      .number()
      .optional()
      .describe('Number of lines to read'),
  },
  async ({ file, offset, limit }) => {
    try {
      const content = readMemoryFile(agentDir, file, offset, limit);
      return {
        content: [
          {
            type: 'text' as const,
            text: content,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error reading memory file: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: memory_list
// ---------------------------------------------------------------------------

server.tool(
  'memory_list',
  'List all memory files for the current agent.',
  {},
  async () => {
    try {
      const files = collectAllFiles(agentDir, agentDir);

      if (files.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No memory files found.',
            },
          ],
        };
      }

      const lines = files.map(
        (f) =>
          `- **${f.relativePath}** (${formatBytes(f.size)}, modified ${f.modified})`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `## Memory Files\n\n${lines.join('\n')}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error listing memory files: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FileInfo {
  relativePath: string;
  size: number;
  modified: string;
}

function collectAllFiles(dir: string, rootDir: string): FileInfo[] {
  const results: FileInfo[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    // Skip hidden files and the sqlite database files
    if (
      entry.startsWith('.') ||
      entry.endsWith('.db') ||
      entry.endsWith('.db-wal') ||
      entry.endsWith('.db-shm')
    ) {
      continue;
    }

    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      results.push(...collectAllFiles(full, rootDir));
    } else if (entry.endsWith('.md')) {
      results.push({
        relativePath: relative(rootDir, full),
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
  }

  return results;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
