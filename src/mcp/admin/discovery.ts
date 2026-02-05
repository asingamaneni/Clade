// ---------------------------------------------------------------------------
// Skill Discovery - Find skills from multiple sources
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  AgentSkill,
  SkillSearchResult,
  SkillSource,
  RegistrySearchOptions,
  GitHubSearchOptions,
} from './types.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CLAUDE_HOME = join(homedir(), '.claude');
const SKILLS_DIR = join(CLAUDE_HOME, 'skills');
const CLADE_HOME = process.env['CLADE_HOME'] ?? join(homedir(), '.clade');

// ---------------------------------------------------------------------------
// SKILL.md Parser
// ---------------------------------------------------------------------------

/**
 * Parse a SKILL.md file into an AgentSkill object
 */
export function parseSkillMd(content: string): Partial<AgentSkill> {
  const skill: Partial<AgentSkill> = {};

  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];

    // Parse YAML-like frontmatter (simple key: value pairs)
    const lines = frontmatter.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        const cleanValue = value.replace(/^["']|["']$/g, '').trim();

        switch (key) {
          case 'name':
            skill.name = cleanValue;
            break;
          case 'description':
            skill.description = cleanValue;
            break;
          case 'license':
            skill.license = cleanValue;
            break;
          case 'compatibility':
            skill.compatibility = cleanValue;
            break;
          case 'allowed-tools':
            skill.allowedTools = cleanValue;
            break;
        }
      }
    }

    // Handle metadata block
    const metadataMatch = frontmatter.match(/metadata:\n((?:\s+\w+:.+\n?)+)/);
    if (metadataMatch) {
      skill.metadata = {};
      const metaLines = metadataMatch[1].split('\n');
      for (const line of metaLines) {
        const match = line.match(/^\s+(\w+)\s*:\s*["']?(.+?)["']?\s*$/);
        if (match) {
          skill.metadata[match[1]] = match[2];
        }
      }
    }
  }

  return skill;
}

// ---------------------------------------------------------------------------
// Local Discovery
// ---------------------------------------------------------------------------

/**
 * Search for skills installed locally in ~/.claude/skills/
 */
export function searchLocalSkills(query?: string): AgentSkill[] {
  const skills: AgentSkill[] = [];

  // Check user skills directory
  const userSkillsDir = SKILLS_DIR;
  if (existsSync(userSkillsDir)) {
    skills.push(...scanSkillsDirectory(userSkillsDir, 'local'));
  }

  // Check project skills if in a project
  const projectSkillsDir = join(process.cwd(), '.claude', 'skills');
  if (existsSync(projectSkillsDir)) {
    skills.push(...scanSkillsDirectory(projectSkillsDir, 'local'));
  }

  // Filter by query if provided
  if (query) {
    const q = query.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q),
    );
  }

  return skills;
}

/**
 * Scan a directory for skill folders containing SKILL.md
 */
function scanSkillsDirectory(dir: string, sourceType: SkillSource['type']): AgentSkill[] {
  const skills: AgentSkill[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = join(dir, entry.name);
      const skillMdPath = join(skillDir, 'SKILL.md');

      if (existsSync(skillMdPath)) {
        try {
          const content = readFileSync(skillMdPath, 'utf-8');
          const skill = parseSkillMd(content);

          skills.push({
            name: skill.name ?? entry.name,
            description: skill.description ?? '',
            license: skill.license,
            compatibility: skill.compatibility,
            allowedTools: skill.allowedTools,
            metadata: skill.metadata,
            path: skillDir,
            source: { type: sourceType },
          });
        } catch {
          // Skip invalid skill files
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return skills;
}

// ---------------------------------------------------------------------------
// GitHub Discovery
// ---------------------------------------------------------------------------

/**
 * Search GitHub for skill repositories
 */
export async function searchGitHub(
  options: GitHubSearchOptions,
): Promise<SkillSearchResult[]> {
  const results: SkillSearchResult[] = [];
  const { query, topic, limit = 20 } = options;

  try {
    // Build search query
    let searchQuery = `${query} SKILL.md in:path`;
    if (topic) {
      searchQuery += ` topic:${topic}`;
    }

    // Use GitHub API via gh CLI for authenticated requests
    const ghCommand = `gh api "search/repositories?q=${encodeURIComponent(searchQuery)}&per_page=${limit}" --jq '.items[] | {name: .name, full_name: .full_name, description: .description, html_url: .html_url, stargazers_count: .stargazers_count, updated_at: .updated_at, owner_login: .owner.login}'`;

    const output = execSync(ghCommand, {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse JSONL output
    const lines = output.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const repo = JSON.parse(line) as {
          name: string;
          full_name: string;
          description: string;
          html_url: string;
          stargazers_count: number;
          updated_at: string;
          owner_login: string;
        };

        results.push({
          name: repo.name,
          description: repo.description ?? '',
          source: {
            type: 'github',
            repo: repo.full_name,
            url: repo.html_url,
          },
          url: repo.html_url,
          stars: repo.stargazers_count,
          author: repo.owner_login,
          lastUpdated: repo.updated_at,
        });
      } catch {
        // Skip invalid JSON lines
      }
    }
  } catch (err) {
    // Fall back to unauthenticated search via fetch
    try {
      const searchQuery = encodeURIComponent(`${query} SKILL.md in:path`);
      const response = await fetch(
        `https://api.github.com/search/repositories?q=${searchQuery}&per_page=${limit}`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'clade-admin-mcp',
          },
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (response.ok) {
        const data = (await response.json()) as {
          items: Array<{
            name: string;
            full_name: string;
            description: string;
            html_url: string;
            stargazers_count: number;
            updated_at: string;
            owner: { login: string };
          }>;
        };

        for (const repo of data.items) {
          results.push({
            name: repo.name,
            description: repo.description ?? '',
            source: {
              type: 'github',
              repo: repo.full_name,
              url: repo.html_url,
            },
            url: repo.html_url,
            stars: repo.stargazers_count,
            author: repo.owner.login,
            lastUpdated: repo.updated_at,
          });
        }
      }
    } catch {
      // Search failed
    }
  }

  return results;
}

/**
 * Search for skills in known skill repositories
 */
export async function searchKnownRepos(query: string): Promise<SkillSearchResult[]> {
  const results: SkillSearchResult[] = [];

  // Known skill repositories
  const knownRepos = [
    'anthropics/skills',
    'agentskills/agentskills',
  ];

  for (const repo of knownRepos) {
    try {
      // List skills in repo using GitHub API
      const ghCommand = `gh api "repos/${repo}/contents/skills" --jq '.[] | select(.type == "dir") | {name: .name, path: .path, html_url: .html_url}'`;

      const output = execSync(ghCommand, {
        encoding: 'utf-8',
        timeout: 15_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const lines = output.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const skill = JSON.parse(line) as {
            name: string;
            path: string;
            html_url: string;
          };

          // Filter by query
          if (query && !skill.name.toLowerCase().includes(query.toLowerCase())) {
            continue;
          }

          results.push({
            name: skill.name,
            description: `Skill from ${repo}`,
            source: {
              type: 'github',
              repo,
              url: skill.html_url,
            },
            url: skill.html_url,
            author: repo.split('/')[0],
          });
        } catch {
          // Skip invalid entries
        }
      }
    } catch {
      // Repo not accessible or gh not available
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// NPM Registry Discovery
// ---------------------------------------------------------------------------

interface NpmSearchResponse {
  objects: Array<{
    package: {
      name: string;
      description?: string;
      version: string;
      date: string;
      keywords?: string[];
      publisher?: {
        username?: string;
      };
      links?: {
        npm?: string;
        repository?: string;
      };
    };
    score?: {
      detail?: {
        popularity?: number;
      };
    };
  }>;
}

/**
 * Search NPM for skill packages
 */
export async function searchNpm(query: string, limit = 20): Promise<SkillSearchResult[]> {
  const results: SkillSearchResult[] = [];

  try {
    const searchQuery = encodeURIComponent(`${query} agent-skill OR claude-skill OR agentskills`);
    const url = `https://registry.npmjs.org/-/v1/search?text=${searchQuery}&size=${limit}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      const data = (await response.json()) as NpmSearchResponse;

      for (const obj of data.objects) {
        const pkg = obj.package;
        const popularity = obj.score?.detail?.popularity ?? 0;

        results.push({
          name: pkg.name,
          description: pkg.description ?? '',
          source: {
            type: 'npm',
            url: pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
          },
          url: pkg.links?.repository ?? pkg.links?.npm,
          downloads: Math.round(popularity * 100_000),
          author: pkg.publisher?.username,
          lastUpdated: pkg.date,
        });
      }
    }
  } catch {
    // Search failed
  }

  return results;
}

// ---------------------------------------------------------------------------
// Web Search Discovery (using DuckDuckGo)
// ---------------------------------------------------------------------------

/**
 * Search the web for skills using DuckDuckGo
 */
export async function searchWeb(query: string): Promise<SkillSearchResult[]> {
  const results: SkillSearchResult[] = [];

  try {
    // Use DuckDuckGo HTML search (no API key needed)
    const searchQuery = encodeURIComponent(`${query} agent skill SKILL.md site:github.com`);
    const url = `https://html.duckduckgo.com/html/?q=${searchQuery}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; clade-admin-mcp/1.0)',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      const html = await response.text();

      // Extract results from HTML (basic parsing)
      const resultMatches = html.matchAll(
        /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g,
      );

      for (const match of resultMatches) {
        const [, url, title] = match;
        if (url && title && url.includes('github.com')) {
          // Extract repo info from GitHub URL
          const repoMatch = url.match(/github\.com\/([^\/]+\/[^\/]+)/);

          results.push({
            name: title.trim(),
            description: `Found via web search`,
            source: {
              type: 'url',
              url,
            },
            url,
            author: repoMatch ? repoMatch[1].split('/')[0] : undefined,
          });
        }
      }
    }
  } catch {
    // Web search failed
  }

  return results;
}

// ---------------------------------------------------------------------------
// Combined Search
// ---------------------------------------------------------------------------

/**
 * Search all sources for skills
 */
export async function searchAllSources(
  query: string,
  options: { includeWeb?: boolean; limit?: number } = {},
): Promise<{
  local: AgentSkill[];
  github: SkillSearchResult[];
  npm: SkillSearchResult[];
  knownRepos: SkillSearchResult[];
  web: SkillSearchResult[];
}> {
  const { includeWeb = true, limit = 10 } = options;

  // Run searches in parallel
  const [local, github, npm, knownRepos, web] = await Promise.all([
    Promise.resolve(searchLocalSkills(query)),
    searchGitHub({ query, limit }),
    searchNpm(query, limit),
    searchKnownRepos(query),
    includeWeb ? searchWeb(query) : Promise.resolve([]),
  ]);

  return { local, github, npm, knownRepos, web };
}
