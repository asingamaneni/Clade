// ---------------------------------------------------------------------------
// Agent portability — export and import agents as .agent.tar.gz bundles
//
// Bundles include the full agent directory (SOUL.md, IDENTITY.md, MEMORY.md,
// HEARTBEAT.md, memory/ logs), an extracted agent-config.json, and a
// manifest.json for version tracking and validation on import.
// ---------------------------------------------------------------------------

import { getAgentsDir, loadConfig, saveConfig } from '../config/index.js';
import { execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  cpSync,
  rmSync,
} from 'fs';
import { join, basename } from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Bundle format version. Increment when the archive layout changes. */
const MANIFEST_VERSION = 1;

/** File extension for agent bundles. */
const BUNDLE_EXT = '.agent.tar.gz';

// ---------------------------------------------------------------------------
// Manifest type
// ---------------------------------------------------------------------------

export interface AgentManifest {
  version: number;
  exportDate: string;
  agentId: string;
  cladeVersion: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the clade version from the nearest package.json.
 * Falls back to "unknown" if the file cannot be read.
 */
function getCladeVersion(): string {
  try {
    // Walk up from this file's location to find the project root package.json.
    // In the built output this lives at dist/agents/portability.js, so we go
    // up three levels (agents -> dist -> project root). At dev time under src/
    // it's two levels. We try both.
    const candidates = [
      join(__dirname, '..', '..', 'package.json'),
      join(__dirname, '..', '..', '..', 'package.json'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
        if (pkg.version) return pkg.version as string;
      }
    }
  } catch {
    // Ignore — fall through to default.
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// exportAgent
// ---------------------------------------------------------------------------

/**
 * Export an agent to a `.agent.tar.gz` bundle.
 *
 * The archive contains:
 *  - The complete agent directory (SOUL.md, IDENTITY.md, MEMORY.md,
 *    HEARTBEAT.md, memory/ daily logs)
 *  - `agent-config.json` — the agent's configuration extracted from config.json
 *  - `manifest.json` — metadata for validation on import
 *
 * @param agentId   - The ID of the agent to export.
 * @param outputPath - Directory where the bundle file will be written.
 * @returns Absolute path to the created `.agent.tar.gz` file.
 */
export async function exportAgent(agentId: string, outputPath: string): Promise<string> {
  const agentsDir = getAgentsDir();
  const agentDir = join(agentsDir, agentId);

  // Validate that the agent directory exists on disk
  if (!existsSync(agentDir)) {
    throw new Error(`Agent directory does not exist: ${agentDir}`);
  }

  // Load config and extract this agent's configuration
  const config = loadConfig();
  const agentConfig = config.agents[agentId];
  if (!agentConfig) {
    throw new Error(`Agent "${agentId}" not found in config`);
  }

  // Ensure the output directory exists
  mkdirSync(outputPath, { recursive: true });

  // Build a staging directory with the bundle contents
  const stagingDir = join(outputPath, `.staging-${agentId}-${Date.now()}`);
  mkdirSync(stagingDir, { recursive: true });

  try {
    // Copy the entire agent directory into the staging area
    const agentStagingDir = join(stagingDir, agentId);
    cpSync(agentDir, agentStagingDir, { recursive: true });

    // Write agent-config.json
    writeFileSync(
      join(stagingDir, 'agent-config.json'),
      JSON.stringify(agentConfig, null, 2) + '\n',
      'utf-8',
    );

    // Write manifest.json
    const manifest: AgentManifest = {
      version: MANIFEST_VERSION,
      exportDate: new Date().toISOString(),
      agentId,
      cladeVersion: getCladeVersion(),
    };
    writeFileSync(
      join(stagingDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf-8',
    );

    // Create the tar.gz bundle
    const bundleName = `${agentId}${BUNDLE_EXT}`;
    const bundlePath = join(outputPath, bundleName);

    execSync(`tar -czf "${bundlePath}" -C "${stagingDir}" .`, {
      stdio: 'pipe',
    });

    return bundlePath;
  } finally {
    // Clean up staging directory
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// importAgent
// ---------------------------------------------------------------------------

/**
 * Import an agent from a `.agent.tar.gz` bundle.
 *
 * Extracts the archive, validates the manifest, copies files into the agents
 * directory, merges the agent config into the global config, and triggers
 * memory reindexing.
 *
 * @param bundlePath - Path to the `.agent.tar.gz` file.
 * @param newId      - Optional replacement agent ID. If omitted, the original
 *                     ID from the manifest is used.
 * @returns The agent ID that was imported.
 */
export async function importAgent(bundlePath: string, newId?: string): Promise<string> {
  if (!existsSync(bundlePath)) {
    throw new Error(`Bundle file does not exist: ${bundlePath}`);
  }

  // Extract to a temporary directory
  const tmpDir = join(
    getAgentsDir(),
    '..',
    `.import-tmp-${Date.now()}`,
  );
  mkdirSync(tmpDir, { recursive: true });

  try {
    execSync(`tar -xzf "${bundlePath}" -C "${tmpDir}"`, {
      stdio: 'pipe',
    });

    // Read and validate the manifest
    const manifestPath = join(tmpDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      throw new Error('Invalid bundle: manifest.json not found');
    }

    const manifest: AgentManifest = JSON.parse(
      readFileSync(manifestPath, 'utf-8'),
    );

    if (typeof manifest.version !== 'number' || typeof manifest.agentId !== 'string') {
      throw new Error('Invalid bundle: manifest.json has invalid structure');
    }

    // Determine the target agent ID
    const targetId = newId ?? manifest.agentId;
    const agentsDir = getAgentsDir();
    const targetDir = join(agentsDir, targetId);

    // Refuse to overwrite an existing agent
    if (existsSync(targetDir)) {
      throw new Error(
        `Agent "${targetId}" already exists. Remove it first or provide a different newId.`,
      );
    }

    // Locate the agent data inside the extracted archive.
    // The original agent's files live under <manifest.agentId>/
    const sourceAgentDir = join(tmpDir, manifest.agentId);
    if (!existsSync(sourceAgentDir)) {
      throw new Error(
        `Invalid bundle: agent directory "${manifest.agentId}" not found in archive`,
      );
    }

    // Copy agent files to the target location
    mkdirSync(agentsDir, { recursive: true });
    cpSync(sourceAgentDir, targetDir, { recursive: true });

    // Read and merge agent-config.json into the global config
    const agentConfigPath = join(tmpDir, 'agent-config.json');
    if (existsSync(agentConfigPath)) {
      const agentConfig = JSON.parse(readFileSync(agentConfigPath, 'utf-8'));
      const config = loadConfig();
      config.agents[targetId] = agentConfig;
      saveConfig(config);
    }

    // Trigger memory reindexing for the imported agent.
    // We use the MCP memory store's reindexAll which walks the agent
    // directory and indexes all .md files into FTS5.
    try {
      const { MemoryStore } = await import('../mcp/memory/store.js');
      const { getDatabasePath } = await import('../config/index.js');
      const store = new MemoryStore(getDatabasePath());
      store.reindexAll(targetDir);
      store.close();
    } catch {
      // Memory reindexing is best-effort — the agent will still work
      // without it, and the next heartbeat or memory write will re-index.
    }

    return targetId;
  } finally {
    // Clean up temp directory
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// listExportableAgents
// ---------------------------------------------------------------------------

/**
 * Returns a list of agent IDs that can be exported.
 *
 * An agent is exportable if it has both:
 *  1. An entry in the global config (config.agents)
 *  2. An on-disk directory under ~/.clade/agents/
 */
export function listExportableAgents(): string[] {
  const config = loadConfig();
  const agentsDir = getAgentsDir();
  const configuredIds = Object.keys(config.agents);

  return configuredIds.filter((id) => {
    const dir = join(agentsDir, id);
    return existsSync(dir);
  });
}
