import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
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
import { saveVersion } from '../../agents/versioning.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const agentId = process.env['CLADE_AGENT_ID'] ?? 'default';
const baseDir =
  process.env['CLADE_HOME'] ?? join(homedir(), '.clade');

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
  name: 'clade-memory',
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
// USER.md and TOOLS.md paths
// ---------------------------------------------------------------------------

const userMdPath = join(baseDir, 'USER.md');
const userHistoryDir = join(baseDir, 'user-history');
const toolsMdPath = join(agentDir, 'TOOLS.md');
const toolsHistoryDir = join(agentDir, 'tools-history');

// ---------------------------------------------------------------------------
// Tool: user_get
// ---------------------------------------------------------------------------

server.tool(
  'user_get',
  'Read the global USER.md file containing user preferences and identity info.',
  {},
  async () => {
    try {
      if (!existsSync(userMdPath)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'USER.md does not exist yet. It will be created when the user updates it.',
            },
          ],
        };
      }
      const content = readFileSync(userMdPath, 'utf-8');
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
            text: `Error reading USER.md: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: user_store
// ---------------------------------------------------------------------------

server.tool(
  'user_store',
  'Update the global USER.md file with user preferences. Use this when the user shares info about themselves (name, timezone, preferences, etc.).',
  {
    content: z.string().describe('The new content for USER.md'),
    section: z
      .string()
      .optional()
      .describe(
        'Optional: specific section to update (e.g., "Preferences"). If omitted, replaces entire file.',
      ),
  },
  async ({ content, section }) => {
    try {
      mkdirSync(userHistoryDir, { recursive: true });

      // Save version before updating
      saveVersion(userMdPath, userHistoryDir);

      if (section) {
        // Section-based update
        let existing = '';
        if (existsSync(userMdPath)) {
          existing = readFileSync(userMdPath, 'utf-8');
        }

        // Find and replace section
        const sectionRegex = new RegExp(
          `(## ${section}\\s*\\n)([\\s\\S]*?)(?=\\n## |$)`,
          'i',
        );
        const match = existing.match(sectionRegex);

        if (match) {
          // Replace existing section
          const updated = existing.replace(
            sectionRegex,
            `$1${content}\n`,
          );
          writeFileSync(userMdPath, updated, 'utf-8');
        } else {
          // Append new section
          const updated = existing.trim() + `\n\n## ${section}\n${content}\n`;
          writeFileSync(userMdPath, updated, 'utf-8');
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Updated section "${section}" in USER.md.`,
            },
          ],
        };
      } else {
        // Replace entire file
        writeFileSync(userMdPath, content, 'utf-8');
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Updated USER.md.',
            },
          ],
        };
      }
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error updating USER.md: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: tools_get
// ---------------------------------------------------------------------------

server.tool(
  'tools_get',
  "Read this agent's TOOLS.md workspace context file.",
  {},
  async () => {
    try {
      if (!existsSync(toolsMdPath)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'TOOLS.md does not exist yet. It will be created when you update it.',
            },
          ],
        };
      }
      const content = readFileSync(toolsMdPath, 'utf-8');
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
            text: `Error reading TOOLS.md: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: tools_store
// ---------------------------------------------------------------------------

server.tool(
  'tools_store',
  "Update this agent's TOOLS.md with workspace-specific notes and context.",
  {
    content: z.string().describe('The new content for TOOLS.md'),
    section: z
      .string()
      .optional()
      .describe(
        'Optional: specific section to update (e.g., "Workspace"). If omitted, replaces entire file.',
      ),
  },
  async ({ content, section }) => {
    try {
      mkdirSync(toolsHistoryDir, { recursive: true });

      // Save version before updating
      saveVersion(toolsMdPath, toolsHistoryDir);

      if (section) {
        // Section-based update
        let existing = '';
        if (existsSync(toolsMdPath)) {
          existing = readFileSync(toolsMdPath, 'utf-8');
        }

        // Find and replace section
        const sectionRegex = new RegExp(
          `(## ${section}\\s*\\n)([\\s\\S]*?)(?=\\n## |$)`,
          'i',
        );
        const match = existing.match(sectionRegex);

        if (match) {
          // Replace existing section
          const updated = existing.replace(
            sectionRegex,
            `$1${content}\n`,
          );
          writeFileSync(toolsMdPath, updated, 'utf-8');
        } else {
          // Append new section
          const updated = existing.trim() + `\n\n## ${section}\n${content}\n`;
          writeFileSync(toolsMdPath, updated, 'utf-8');
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Updated section "${section}" in TOOLS.md.`,
            },
          ],
        };
      } else {
        // Replace entire file
        writeFileSync(toolsMdPath, content, 'utf-8');
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Updated TOOLS.md.',
            },
          ],
        };
      }
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error updating TOOLS.md: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
