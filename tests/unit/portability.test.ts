// ---------------------------------------------------------------------------
// Tests: Agent Portability (export / import)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  exportAgent,
  importAgent,
  listExportableAgents,
} from '../../src/agents/portability.js';
import { loadConfig, saveConfig, getAgentsDir } from '../../src/config/index.js';
import { ConfigSchema } from '../../src/config/schema.js';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Test setup — isolated CLADE_HOME per test
// ---------------------------------------------------------------------------

let testHome: string;
let outputDir: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'clade-portability-'));
  outputDir = mkdtempSync(join(tmpdir(), 'clade-export-output-'));
  process.env['CLADE_HOME'] = testHome;

  // Create the agents directory
  mkdirSync(join(testHome, 'agents'), { recursive: true });
});

afterEach(() => {
  delete process.env['CLADE_HOME'];
  if (existsSync(testHome)) {
    rmSync(testHome, { recursive: true, force: true });
  }
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed an agent on disk and in config so it can be exported.
 */
function seedAgent(
  agentId: string,
  options?: { soulContent?: string; memoryContent?: string; dailyLogs?: string[] },
): void {
  const agentsDir = getAgentsDir();
  const agentDir = join(agentsDir, agentId);
  const memoryDir = join(agentDir, 'memory');
  mkdirSync(memoryDir, { recursive: true });

  writeFileSync(
    join(agentDir, 'SOUL.md'),
    options?.soulContent ?? `# Soul\nI am ${agentId}.\n`,
    'utf-8',
  );
  writeFileSync(
    join(agentDir, 'IDENTITY.md'),
    `# Identity\nName: ${agentId}\n`,
    'utf-8',
  );
  writeFileSync(
    join(agentDir, 'MEMORY.md'),
    options?.memoryContent ?? `# Memory\nSome memories for ${agentId}.\n`,
    'utf-8',
  );
  writeFileSync(
    join(agentDir, 'HEARTBEAT.md'),
    `# Heartbeat\n- [ ] Check stuff\n`,
    'utf-8',
  );

  // Write daily logs if provided
  if (options?.dailyLogs) {
    for (const date of options.dailyLogs) {
      writeFileSync(
        join(memoryDir, `${date}.md`),
        `# ${date}\nSomething happened today.\n`,
        'utf-8',
      );
    }
  }

  // Write a config with this agent
  const config = ConfigSchema.parse({
    agents: {
      [agentId]: {
        name: `Agent ${agentId}`,
        description: `Test agent ${agentId}`,
        model: 'sonnet',
        toolPreset: 'coding',
      },
    },
  });
  saveConfig(config);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('exportAgent', () => {
  it('should create a valid tar.gz file', async () => {
    seedAgent('alpha');
    const bundlePath = await exportAgent('alpha', outputDir);

    // The bundle file should exist and have the correct name
    expect(existsSync(bundlePath)).toBe(true);
    expect(bundlePath).toContain('alpha.agent.tar.gz');

    // Verify it is a valid gzip file by listing its contents
    const listing = execSync(`tar -tzf "${bundlePath}"`, { encoding: 'utf-8' });
    expect(listing).toContain('manifest.json');
    expect(listing).toContain('agent-config.json');
    expect(listing).toContain('alpha/SOUL.md');
    expect(listing).toContain('alpha/IDENTITY.md');
    expect(listing).toContain('alpha/MEMORY.md');
    expect(listing).toContain('alpha/HEARTBEAT.md');
  });

  it('should include daily memory logs in the bundle', async () => {
    seedAgent('beta', { dailyLogs: ['2025-01-15', '2025-01-16'] });
    const bundlePath = await exportAgent('beta', outputDir);

    const listing = execSync(`tar -tzf "${bundlePath}"`, { encoding: 'utf-8' });
    expect(listing).toContain('beta/memory/2025-01-15.md');
    expect(listing).toContain('beta/memory/2025-01-16.md');
  });

  it('should write a valid manifest.json with correct fields', async () => {
    seedAgent('gamma');
    const bundlePath = await exportAgent('gamma', outputDir);

    // Extract and read the manifest
    const extractDir = mkdtempSync(join(tmpdir(), 'clade-verify-'));
    try {
      execSync(`tar -xzf "${bundlePath}" -C "${extractDir}"`, { stdio: 'pipe' });
      const manifest = JSON.parse(
        readFileSync(join(extractDir, 'manifest.json'), 'utf-8'),
      );

      expect(manifest.version).toBe(1);
      expect(manifest.agentId).toBe('gamma');
      expect(typeof manifest.exportDate).toBe('string');
      expect(typeof manifest.cladeVersion).toBe('string');
      // exportDate should be a valid ISO date
      expect(new Date(manifest.exportDate).toISOString()).toBe(manifest.exportDate);
    } finally {
      rmSync(extractDir, { recursive: true, force: true });
    }
  });

  it('should include agent-config.json with the correct config', async () => {
    seedAgent('delta');
    const bundlePath = await exportAgent('delta', outputDir);

    const extractDir = mkdtempSync(join(tmpdir(), 'clade-verify-'));
    try {
      execSync(`tar -xzf "${bundlePath}" -C "${extractDir}"`, { stdio: 'pipe' });
      const agentConfig = JSON.parse(
        readFileSync(join(extractDir, 'agent-config.json'), 'utf-8'),
      );

      expect(agentConfig.name).toBe('Agent delta');
      expect(agentConfig.description).toBe('Test agent delta');
      expect(agentConfig.model).toBe('sonnet');
      expect(agentConfig.toolPreset).toBe('coding');
    } finally {
      rmSync(extractDir, { recursive: true, force: true });
    }
  });

  it('should throw if agent directory does not exist', async () => {
    // Write config but no directory
    const config = ConfigSchema.parse({
      agents: { ghost: { name: 'Ghost' } },
    });
    saveConfig(config);

    await expect(exportAgent('ghost', outputDir)).rejects.toThrow(
      'Agent directory does not exist',
    );
  });

  it('should throw if agent is not in config', async () => {
    // Create directory but no config entry
    const agentDir = join(getAgentsDir(), 'orphan');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'SOUL.md'), '# Soul\n', 'utf-8');

    // Save config without the agent
    saveConfig(ConfigSchema.parse({}));

    await expect(exportAgent('orphan', outputDir)).rejects.toThrow(
      'not found in config',
    );
  });
});

describe('importAgent', () => {
  it('should extract and create agent directory', async () => {
    seedAgent('source');
    const bundlePath = await exportAgent('source', outputDir);

    // Remove the original agent to simulate importing on a fresh system
    rmSync(join(getAgentsDir(), 'source'), { recursive: true, force: true });
    const config = loadConfig();
    delete config.agents['source'];
    saveConfig(config);

    const importedId = await importAgent(bundlePath);

    expect(importedId).toBe('source');
    const agentDir = join(getAgentsDir(), 'source');
    expect(existsSync(agentDir)).toBe(true);
    expect(existsSync(join(agentDir, 'SOUL.md'))).toBe(true);
    expect(existsSync(join(agentDir, 'IDENTITY.md'))).toBe(true);
    expect(existsSync(join(agentDir, 'MEMORY.md'))).toBe(true);
    expect(existsSync(join(agentDir, 'HEARTBEAT.md'))).toBe(true);
    expect(existsSync(join(agentDir, 'memory'))).toBe(true);
  });

  it('should merge agent config into global config', async () => {
    seedAgent('configtest');
    const bundlePath = await exportAgent('configtest', outputDir);

    // Remove original agent
    rmSync(join(getAgentsDir(), 'configtest'), { recursive: true, force: true });
    const config = loadConfig();
    delete config.agents['configtest'];
    saveConfig(config);

    await importAgent(bundlePath);

    const updatedConfig = loadConfig();
    expect(updatedConfig.agents['configtest']).toBeDefined();
    expect(updatedConfig.agents['configtest']!.name).toBe('Agent configtest');
    expect(updatedConfig.agents['configtest']!.toolPreset).toBe('coding');
  });

  it('should rename agent when newId is provided', async () => {
    seedAgent('original');
    const bundlePath = await exportAgent('original', outputDir);

    const importedId = await importAgent(bundlePath, 'renamed');

    expect(importedId).toBe('renamed');
    const renamedDir = join(getAgentsDir(), 'renamed');
    expect(existsSync(renamedDir)).toBe(true);
    expect(existsSync(join(renamedDir, 'SOUL.md'))).toBe(true);

    // Config should have the new ID
    const config = loadConfig();
    expect(config.agents['renamed']).toBeDefined();
    expect(config.agents['renamed']!.name).toBe('Agent original');
  });

  it('should refuse to overwrite an existing agent', async () => {
    seedAgent('existing');
    const bundlePath = await exportAgent('existing', outputDir);

    // Agent still exists on disk — import should fail
    await expect(importAgent(bundlePath)).rejects.toThrow('already exists');
  });

  it('should refuse to overwrite when newId collides with existing agent', async () => {
    seedAgent('first');
    seedAgent('second');

    // Re-seed config with both agents so config has both
    const config = ConfigSchema.parse({
      agents: {
        first: { name: 'First', toolPreset: 'coding' },
        second: { name: 'Second', toolPreset: 'full' },
      },
    });
    saveConfig(config);

    const bundlePath = await exportAgent('first', outputDir);

    // Try to import as "second" which already exists
    await expect(importAgent(bundlePath, 'second')).rejects.toThrow('already exists');
  });

  it('should throw if bundle file does not exist', async () => {
    await expect(importAgent('/nonexistent/bundle.agent.tar.gz')).rejects.toThrow(
      'Bundle file does not exist',
    );
  });

  it('should throw if bundle has no manifest.json', async () => {
    // Create a tar.gz without manifest.json
    const fakeDir = mkdtempSync(join(tmpdir(), 'clade-fake-'));
    const fakeBundlePath = join(outputDir, 'fake.agent.tar.gz');
    writeFileSync(join(fakeDir, 'random.txt'), 'hello', 'utf-8');
    execSync(`tar -czf "${fakeBundlePath}" -C "${fakeDir}" .`, { stdio: 'pipe' });
    rmSync(fakeDir, { recursive: true, force: true });

    await expect(importAgent(fakeBundlePath)).rejects.toThrow('manifest.json not found');
  });

  it('should preserve daily memory logs through import', async () => {
    seedAgent('logkeeper', { dailyLogs: ['2025-03-01', '2025-03-02'] });
    const bundlePath = await exportAgent('logkeeper', outputDir);

    // Import under a new name to avoid collision
    const importedId = await importAgent(bundlePath, 'logkeeper-copy');

    const memoryDir = join(getAgentsDir(), 'logkeeper-copy', 'memory');
    expect(existsSync(join(memoryDir, '2025-03-01.md'))).toBe(true);
    expect(existsSync(join(memoryDir, '2025-03-02.md'))).toBe(true);
  });
});

describe('round-trip: export then import', () => {
  it('should produce identical files', async () => {
    const soulContent = '# Soul\nI am a unique agent with special abilities.\n';
    const memoryContent = '# Memory\nI remember the color blue and the number 42.\n';
    seedAgent('roundtrip', {
      soulContent,
      memoryContent,
      dailyLogs: ['2025-06-15'],
    });

    // Export
    const bundlePath = await exportAgent('roundtrip', outputDir);

    // Import under a new ID
    const importedId = await importAgent(bundlePath, 'roundtrip-clone');
    expect(importedId).toBe('roundtrip-clone');

    // Compare file contents between original and imported
    const origDir = join(getAgentsDir(), 'roundtrip');
    const cloneDir = join(getAgentsDir(), 'roundtrip-clone');

    const filesToCompare = ['SOUL.md', 'IDENTITY.md', 'MEMORY.md', 'HEARTBEAT.md'];
    for (const file of filesToCompare) {
      const origContent = readFileSync(join(origDir, file), 'utf-8');
      const cloneContent = readFileSync(join(cloneDir, file), 'utf-8');
      expect(cloneContent).toBe(origContent);
    }

    // Compare daily log
    const origLog = readFileSync(join(origDir, 'memory', '2025-06-15.md'), 'utf-8');
    const cloneLog = readFileSync(join(cloneDir, 'memory', '2025-06-15.md'), 'utf-8');
    expect(cloneLog).toBe(origLog);

    // Compare config
    const config = loadConfig();
    const origConfig = config.agents['roundtrip'];
    const cloneConfig = config.agents['roundtrip-clone'];
    expect(cloneConfig!.name).toBe(origConfig!.name);
    expect(cloneConfig!.description).toBe(origConfig!.description);
    expect(cloneConfig!.model).toBe(origConfig!.model);
    expect(cloneConfig!.toolPreset).toBe(origConfig!.toolPreset);
  });
});

describe('listExportableAgents', () => {
  it('should return agents that exist in both config and on disk', () => {
    seedAgent('exportable-a');

    // Also seed a second agent
    const agentsDir = getAgentsDir();
    const bDir = join(agentsDir, 'exportable-b');
    mkdirSync(bDir, { recursive: true });
    writeFileSync(join(bDir, 'SOUL.md'), '# Soul\n', 'utf-8');

    // Update config to include both
    const config = ConfigSchema.parse({
      agents: {
        'exportable-a': { name: 'A', toolPreset: 'coding' },
        'exportable-b': { name: 'B', toolPreset: 'full' },
      },
    });
    saveConfig(config);

    const exportable = listExportableAgents();
    expect(exportable).toContain('exportable-a');
    expect(exportable).toContain('exportable-b');
  });

  it('should exclude agents in config but not on disk', () => {
    // Write config with an agent but do not create its directory
    const config = ConfigSchema.parse({
      agents: {
        'no-dir': { name: 'No Dir' },
      },
    });
    saveConfig(config);

    const exportable = listExportableAgents();
    expect(exportable).not.toContain('no-dir');
  });

  it('should return empty list when no agents are configured', () => {
    saveConfig(ConfigSchema.parse({}));
    // The default config includes "main" agent but we have no dir for it
    const exportable = listExportableAgents();
    // "main" is in the default config but has no directory on disk
    for (const id of exportable) {
      expect(existsSync(join(getAgentsDir(), id))).toBe(true);
    }
  });
});
