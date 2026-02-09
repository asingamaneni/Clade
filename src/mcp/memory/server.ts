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
import {
  checkAndArchiveMemory,
  consolidateDailyLogs,
} from './consolidation.js';
import { saveVersion } from '../../agents/versioning.js';
import { embeddingProvider } from './embeddings.js';

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
// Background embedding generation
// ---------------------------------------------------------------------------

let embeddingInProgress = false;

/**
 * Generate embeddings for any chunks that don't have them yet.
 * Runs in the background — does not block the calling tool.
 */
async function generateMissingEmbeddings(): Promise<void> {
  if (embeddingInProgress) return;
  embeddingInProgress = true;

  try {
    const missing = store.getChunksWithoutEmbeddings();
    if (missing.length === 0) return;

    for (const { id, chunkText } of missing) {
      try {
        const embedding = await embeddingProvider.embed(chunkText);
        store.storeEmbedding(id, embedding);
      } catch {
        // Model not available — stop trying
        break;
      }
    }
  } finally {
    embeddingInProgress = false;
  }
}

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

        // Auto-archive if MEMORY.md exceeds size limit
        const archiveResult = checkAndArchiveMemory(agentDir);
        if (archiveResult.archived) {
          // Re-index after archival rewrote MEMORY.md
          store.reindexChanged(agentDir);
        }

        const archiveNote = archiveResult.archived
          ? ` (auto-archived ${archiveResult.sectionsArchived} old sections)`
          : '';

        return {
          content: [
            {
              type: 'text' as const,
              text: `Stored to long-term memory (MEMORY.md).${archiveNote}`,
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
  'Search across all memory files. Supports keyword (FTS5), semantic (vector similarity), or hybrid (combined) modes.',
  {
    query: z.string().describe('Search query'),
    limit: z.number().default(10).describe('Maximum number of results'),
    mode: z
      .enum(['keyword', 'semantic', 'hybrid'])
      .default('keyword')
      .describe(
        'Search mode: "keyword" (FTS5), "semantic" (vector similarity), or "hybrid" (combined). Falls back to keyword if embeddings are unavailable.',
      ),
  },
  async ({ query, limit, mode }) => {
    try {
      // Incrementally re-index only files that changed since last search
      store.reindexChanged(agentDir);

      // Trigger background embedding generation for any new chunks
      generateMissingEmbeddings().catch(() => {});

      let results;
      const useVector = (mode === 'semantic' || mode === 'hybrid') && store.hasEmbeddings();

      if (useVector) {
        try {
          const queryEmbedding = await embeddingProvider.embed(query);
          if (mode === 'hybrid') {
            results = store.hybridSearch(query, queryEmbedding, limit);
          } else {
            results = store.vectorSearch(queryEmbedding, limit);
          }
        } catch {
          // Embedding failed — fall back to keyword search
          results = store.search(query, limit);
        }
      } else {
        results = store.search(query, limit);
      }

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

      const modeUsed = useVector ? mode : 'keyword';
      const formatted = results.map((r, i) => {
        const snippet =
          r.chunkText.length > 300
            ? r.chunkText.slice(0, 300) + '...'
            : r.chunkText;
        const simNote = r.similarity !== undefined
          ? `\n- **Similarity:** ${r.similarity.toFixed(4)}`
          : '';
        return [
          `### Result ${i + 1}`,
          `- **File:** ${r.filePath}`,
          `- **Lines:** ${r.chunkStart}-${r.chunkEnd} (char offset)`,
          `- **Relevance:** ${r.rank.toFixed(4)}${simNote}`,
          '',
          snippet,
        ].join('\n');
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `*Search mode: ${modeUsed}*\n\n${formatted.join('\n\n---\n\n')}`,
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
// Tool: memory_delete
// ---------------------------------------------------------------------------

server.tool(
  'memory_delete',
  'Delete a specific entry from MEMORY.md or a daily log, or delete an entire memory file.',
  {
    file: z
      .string()
      .describe(
        'Relative path within agent directory, e.g. "MEMORY.md" or "memory/2026-02-01.md"',
      ),
    pattern: z
      .string()
      .optional()
      .describe(
        'If provided, delete only lines/sections matching this text. If omitted, delete the entire file.',
      ),
  },
  async ({ file, pattern }) => {
    try {
      const fullPath = join(agentDir, file);
      if (!existsSync(fullPath)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `File "${file}" not found.`,
            },
          ],
          isError: true,
        };
      }

      // Security: ensure the path is within agentDir
      const { resolve } = await import('node:path');
      const resolved = resolve(fullPath);
      const agentResolved = resolve(agentDir);
      if (!resolved.startsWith(agentResolved)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Access denied: path is outside agent directory.',
            },
          ],
          isError: true,
        };
      }

      if (!pattern) {
        // Delete entire file
        const { unlinkSync } = await import('node:fs');
        unlinkSync(fullPath);
        store.removeFile(file);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Deleted "${file}".`,
            },
          ],
        };
      }

      // Delete matching lines/sections
      const content = readFileSync(fullPath, 'utf-8');
      const patternLower = pattern.toLowerCase();

      // Try section-based deletion first (## heading blocks)
      const sectionRegex = new RegExp(
        `(^## [^\\n]*${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\n)([\\s\\S]*?)(?=^## |\\Z)`,
        'im',
      );
      const sectionMatch = content.match(sectionRegex);

      let updated: string;
      let deletedCount: number;

      if (sectionMatch) {
        // Remove the matched section
        updated = content.replace(sectionRegex, '');
        deletedCount = 1;
      } else {
        // Fall back to line-based deletion
        const lines = content.split('\n');
        const kept = lines.filter(
          (line) => !line.toLowerCase().includes(patternLower),
        );
        deletedCount = lines.length - kept.length;
        updated = kept.join('\n');
      }

      if (deletedCount === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No matching content found for "${pattern}" in "${file}".`,
            },
          ],
        };
      }

      writeFileSync(fullPath, updated, 'utf-8');
      // Re-index the updated file
      store.indexFile(file, updated);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Deleted ${deletedCount} matching ${sectionMatch ? 'section' : 'line'}(s) from "${file}".`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error deleting memory: ${err instanceof Error ? err.message : String(err)}`,
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
// Tool: memory_consolidate
// ---------------------------------------------------------------------------

server.tool(
  'memory_consolidate',
  'Consolidate recent daily logs into MEMORY.md and archive old sections. Extracts important facts from daily logs and appends them to long-term memory, then optionally archives oversized MEMORY.md sections.',
  {
    days: z
      .number()
      .default(7)
      .describe('How many days of daily logs to process'),
    archive: z
      .boolean()
      .default(true)
      .describe('Whether to also archive oversized MEMORY.md'),
  },
  async ({ days, archive }) => {
    try {
      // Step 1: Consolidate daily logs into MEMORY.md
      const consolidation = consolidateDailyLogs(agentDir, days);

      // Step 2: Optionally archive oversized MEMORY.md
      let archiveResult = null;
      if (archive) {
        archiveResult = checkAndArchiveMemory(agentDir);
      }

      // Step 3: Re-index MEMORY.md and any new archive files
      store.reindexChanged(agentDir);

      // Build response
      const parts: string[] = [
        `## Consolidation Results`,
        '',
        `- **Days processed:** ${consolidation.daysProcessed}`,
        `- **Facts extracted:** ${consolidation.factsExtracted}`,
        `- **New facts added:** ${consolidation.factsAdded}`,
      ];

      if (archiveResult) {
        parts.push('');
        if (archiveResult.archived) {
          parts.push(`## Archive Results`);
          parts.push('');
          parts.push(
            `- **Sections archived:** ${archiveResult.sectionsArchived}`,
          );
          parts.push(
            `- **New MEMORY.md size:** ${archiveResult.newSize} chars`,
          );
        } else {
          parts.push(
            `MEMORY.md is within size limit (${archiveResult.newSize} chars). No archiving needed.`,
          );
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: parts.join('\n'),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error consolidating memory: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Skills directory
// ---------------------------------------------------------------------------

const skillsDir = join(baseDir, 'skills');

// ---------------------------------------------------------------------------
// Tool: skill_create
// ---------------------------------------------------------------------------

server.tool(
  'skill_create',
  'Create a new skill (SKILL.md) for reusable procedures, guides, or checklists. Skills go to pending/ and require human approval before becoming active.',
  {
    name: z
      .string()
      .describe(
        'Skill name (lowercase letters, numbers, hyphens, underscores only)',
      ),
    description: z
      .string()
      .describe('Brief description of what this skill teaches or does'),
    content: z
      .string()
      .describe('The full SKILL.md markdown content'),
  },
  async ({ name, description, content }) => {
    try {
      // Validate name
      if (!/^[a-z0-9_-]+$/.test(name)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Invalid skill name. Use only lowercase letters, numbers, hyphens, and underscores.',
            },
          ],
          isError: true,
        };
      }

      const skillDir = join(skillsDir, 'pending', name);

      // Check if skill already exists in any status directory
      for (const status of ['active', 'pending', 'disabled']) {
        if (existsSync(join(skillsDir, status, name))) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Skill "${name}" already exists (status: ${status}).`,
              },
            ],
            isError: true,
          };
        }
      }

      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');

      // Write a metadata file so the server can identify who created it
      const meta = {
        name,
        description,
        createdBy: agentId,
        createdAt: new Date().toISOString(),
      };
      writeFileSync(
        join(skillDir, 'meta.json'),
        JSON.stringify(meta, null, 2),
        'utf-8',
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `Skill "${name}" created in pending/. Awaiting human approval before it becomes active.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error creating skill: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: skill_list
// ---------------------------------------------------------------------------

server.tool(
  'skill_list',
  'List all skills across active, pending, and disabled directories.',
  {},
  async () => {
    try {
      const results: Array<{ name: string; status: string; description: string }> = [];

      for (const status of ['active', 'pending', 'disabled'] as const) {
        const dir = join(skillsDir, status);
        if (!existsSync(dir)) continue;

        let entries: string[];
        try {
          entries = readdirSync(dir);
        } catch {
          continue;
        }

        for (const entry of entries) {
          const entryPath = join(dir, entry);
          try {
            if (!statSync(entryPath).isDirectory()) continue;
          } catch {
            continue;
          }

          let description = '';
          // Try meta.json first, then parse SKILL.md header
          const metaPath = join(entryPath, 'meta.json');
          const skillMdPath = join(entryPath, 'SKILL.md');

          if (existsSync(metaPath)) {
            try {
              const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
              description = meta.description ?? '';
            } catch { /* ignore parse errors */ }
          }

          if (!description && existsSync(skillMdPath)) {
            try {
              const content = readFileSync(skillMdPath, 'utf-8');
              const match = content.match(/^#[^\n]*\n+([^\n]+)/);
              if (match) description = match[1].trim();
            } catch { /* ignore read errors */ }
          }

          results.push({ name: entry, status, description });
        }
      }

      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No skills found.',
            },
          ],
        };
      }

      const lines = results.map(
        (s) => `- **${s.name}** [${s.status}] — ${s.description || '(no description)'}`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `## Skills\n\n${lines.join('\n')}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error listing skills: ${err instanceof Error ? err.message : String(err)}`,
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
