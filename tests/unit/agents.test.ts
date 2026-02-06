// ---------------------------------------------------------------------------
// Tests: Agent Registry
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentRegistry } from '../../src/agents/registry.js';
import { resolveAllowedTools, describePreset, getPresetMap } from '../../src/agents/presets.js';
import { DEFAULT_SOUL, DEFAULT_HEARTBEAT } from '../../src/config/defaults.js';
import { ConfigSchema } from '../../src/config/schema.js';
import type { Config, ToolPreset } from '../../src/config/schema.js';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_HOME = join(tmpdir(), `clade-test-agents-${Date.now()}`);

describe('AgentRegistry', () => {
  beforeEach(() => {
    process.env['CLADE_HOME'] = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });
    mkdirSync(join(TEST_HOME, 'agents'), { recursive: true });
  });

  afterEach(() => {
    delete process.env['CLADE_HOME'];
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
  });

  it('should load agents from config', () => {
    const config = ConfigSchema.parse({
      agents: {
        main: { name: 'Main', toolPreset: 'full' },
        coder: { name: 'Coder', toolPreset: 'coding' },
      },
    });

    const registry = new AgentRegistry(config);
    expect(registry.size).toBe(2);
    expect(registry.has('main')).toBe(true);
    expect(registry.has('coder')).toBe(true);
  });

  it('should create agent directories on disk', () => {
    const config = ConfigSchema.parse({
      agents: {
        test: { name: 'Test Agent' },
      },
    });

    new AgentRegistry(config);
    const agentDir = join(TEST_HOME, 'agents', 'test');
    expect(existsSync(agentDir)).toBe(true);
    expect(existsSync(join(agentDir, 'SOUL.md'))).toBe(true);
    expect(existsSync(join(agentDir, 'HEARTBEAT.md'))).toBe(true);
    expect(existsSync(join(agentDir, 'MEMORY.md'))).toBe(true);
    expect(existsSync(join(agentDir, 'memory'))).toBe(true);
  });

  it('should create default SOUL.md when absent', () => {
    const config = ConfigSchema.parse({
      agents: { newagent: { name: 'New Agent' } },
    });

    new AgentRegistry(config);
    const soulPath = join(TEST_HOME, 'agents', 'newagent', 'SOUL.md');
    const content = readFileSync(soulPath, 'utf-8');
    expect(content).toBe(DEFAULT_SOUL);
  });

  it('should get an agent by ID', () => {
    const config = ConfigSchema.parse({
      agents: { main: { name: 'Main', model: 'opus' } },
    });

    const registry = new AgentRegistry(config);
    const agent = registry.get('main');
    expect(agent.id).toBe('main');
    expect(agent.config.name).toBe('Main');
    expect(agent.config.model).toBe('opus');
  });

  it('should throw AgentNotFoundError for unknown agent', () => {
    const config = ConfigSchema.parse({});
    const registry = new AgentRegistry(config);

    expect(() => registry.get('nonexistent')).toThrow('not found');
  });

  it('should list all agents', () => {
    const config = ConfigSchema.parse({
      agents: {
        a: { name: 'A' },
        b: { name: 'B' },
      },
    });

    const registry = new AgentRegistry(config);
    const agents = registry.list();
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.id).sort()).toEqual(['a', 'b']);
  });

  it('should return agent IDs', () => {
    const config = ConfigSchema.parse({
      agents: {
        x: { name: 'X' },
        y: { name: 'Y' },
      },
    });

    const registry = new AgentRegistry(config);
    const ids = registry.ids();
    expect(ids.sort()).toEqual(['x', 'y']);
  });

  it('should read SOUL.md for an agent', () => {
    const config = ConfigSchema.parse({
      agents: { main: { name: 'Main' } },
    });

    const registry = new AgentRegistry(config);
    const soul = registry.readSoul('main');
    expect(soul).toContain('SOUL.md');
  });

  it('should register a new agent at runtime', () => {
    const config = ConfigSchema.parse({});
    const registry = new AgentRegistry(config);

    const agent = registry.register('dynamic', {
      name: 'Dynamic',
      description: '',
      model: 'sonnet',
      toolPreset: 'coding',
      customTools: [],
      mcp: [],
      heartbeat: { enabled: false, interval: '30m', mode: 'check', suppressOk: true },
      maxTurns: 25,
    });

    expect(agent.id).toBe('dynamic');
    expect(registry.has('dynamic')).toBe(true);
  });

  it('should unregister an agent', () => {
    const config = ConfigSchema.parse({
      agents: { main: { name: 'Main' } },
    });

    const registry = new AgentRegistry(config);
    const removed = registry.unregister('main');
    expect(removed).toBe(true);
    expect(registry.has('main')).toBe(false);
  });
});

describe('Tool Presets', () => {
  it('should resolve potato preset to empty array', () => {
    const tools = resolveAllowedTools('potato');
    expect(tools).toEqual([]);
  });

  it('should resolve coding preset to coding tools + MCP', () => {
    const tools = resolveAllowedTools('coding');
    expect(tools).toContain('Read');
    expect(tools).toContain('Edit');
    expect(tools).toContain('Write');
    expect(tools).toContain('Bash');
    expect(tools).toContain('Glob');
    expect(tools).toContain('Grep');
    expect(tools).toContain('mcp__memory__*');
    expect(tools).toContain('mcp__sessions__*');
    // Skills MCP is now included for capability discovery
    expect(tools).toContain('mcp__mcp-manager__*');
    // Should not include messaging MCP
    expect(tools).not.toContain('mcp__messaging__*');
  });

  it('should resolve messaging preset to MCP-only tools', () => {
    const tools = resolveAllowedTools('messaging');
    expect(tools).toContain('mcp__memory__*');
    expect(tools).toContain('mcp__sessions__*');
    expect(tools).toContain('mcp__messaging__*');
    expect(tools).toContain('mcp__mcp-manager__*');
    // Should not include native code tools
    expect(tools).not.toContain('Read');
    expect(tools).not.toContain('Bash');
  });

  it('should resolve full preset to all tools', () => {
    const tools = resolveAllowedTools('full');
    expect(tools).toContain('Read');
    expect(tools).toContain('Bash');
    expect(tools).toContain('WebFetch');
    expect(tools).toContain('Task');
    expect(tools).toContain('mcp__memory__*');
    expect(tools).toContain('mcp__sessions__*');
    expect(tools).toContain('mcp__messaging__*');
    expect(tools).toContain('mcp__mcp-manager__*');
  });

  it('should resolve custom preset to provided custom tools', () => {
    const tools = resolveAllowedTools('custom', ['Read', 'Write', 'MyTool']);
    expect(tools).toEqual(['Read', 'Write', 'MyTool']);
  });

  it('should resolve custom preset to empty array when no custom tools', () => {
    const tools = resolveAllowedTools('custom');
    expect(tools).toEqual([]);
  });

  it('should describe presets in human-readable form', () => {
    expect(describePreset('potato')).toContain('No tools');
    expect(describePreset('coding')).toContain('File');
    expect(describePreset('messaging')).toContain('MCP');
    expect(describePreset('full')).toContain('All');
    expect(describePreset('custom')).toContain('Custom');
  });

  it('should expose the preset map', () => {
    const map = getPresetMap();
    expect(map.potato).toEqual([]);
    expect(map.full.length).toBeGreaterThan(0);
  });
});
