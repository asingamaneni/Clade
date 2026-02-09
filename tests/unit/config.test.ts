// ---------------------------------------------------------------------------
// Tests: Configuration system
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigSchema, SkillsConfigSchema, AgentConfigSchema } from '../../src/config/schema.js';
import {
  loadConfig,
  saveConfig,
  expandEnvVars,
  getConfigDir,
  getConfigPath,
} from '../../src/config/index.js';
import { generateDefaultConfig, DEFAULT_SOUL, DEFAULT_HEARTBEAT } from '../../src/config/defaults.js';
import { migrateConfig, currentSchemaVersion } from '../../src/config/migrations.js';
import type { Config } from '../../src/config/schema.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Use a temporary directory for all config tests
const TEST_HOME = join(tmpdir(), `clade-test-config-${Date.now()}`);

describe('Config Schema', () => {
  it('should parse empty object with all defaults', () => {
    const config = ConfigSchema.parse({});

    expect(config.agents).toBeDefined();
    // No pre-defined agents — starts empty
    expect(Object.keys(config.agents)).toHaveLength(0);
    expect(config.channels).toBeDefined();
    expect(config.gateway.port).toBe(7890);
    expect(config.gateway.host).toBe('127.0.0.1');
    expect(config.routing.defaultAgent).toBe('');
    expect(config.version).toBe(5);
  });

  it('should validate a fully specified config', () => {
    const input = {
      agents: {
        myagent: {
          name: 'My Agent',
          description: 'A custom agent',
          model: 'opus',
          toolPreset: 'coding',
          customTools: [],
          mcp: ['memory'],
          heartbeat: {
            enabled: true,
            interval: '1h',
            suppressOk: false,
            mode: 'work',
          },
          maxTurns: 10,
        },
      },
      channels: {
        telegram: { enabled: true, token: 'abc123' },
        slack: { enabled: false },
        discord: { enabled: false },
        webchat: { enabled: true },
      },
      gateway: { port: 8080, host: '0.0.0.0' },
      routing: {
        defaultAgent: 'myagent',
        rules: [
          { channel: 'telegram', agentId: 'myagent' },
        ],
      },
      mcp: { autoApprove: ['memory'] },
    };

    const config = ConfigSchema.parse(input);
    expect(config.agents['myagent']!.name).toBe('My Agent');
    expect(config.agents['myagent']!.toolPreset).toBe('coding');
    expect(config.agents['myagent']!.heartbeat.enabled).toBe(true);
    expect(config.agents['myagent']!.heartbeat.interval).toBe('1h');
    expect(config.agents['myagent']!.heartbeat.mode).toBe('work');
    expect(config.gateway.port).toBe(8080);
    expect(config.routing.rules).toHaveLength(1);
  });

  it('should reject invalid tool preset', () => {
    const input = {
      agents: {
        bad: {
          name: 'Bad Agent',
          toolPreset: 'nonexistent',
        },
      },
    };

    const result = ConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject invalid gateway port', () => {
    const input = {
      gateway: { port: 99999 },
    };

    const result = ConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject invalid heartbeat interval', () => {
    const input = {
      agents: {
        bad: {
          name: 'Bad',
          heartbeat: { enabled: true, interval: '99x' },
        },
      },
    };

    const result = ConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should apply default heartbeat values', () => {
    const input = {
      agents: {
        test: {
          name: 'Test',
        },
      },
    };

    const config = ConfigSchema.parse(input);
    expect(config.agents['test']!.heartbeat.enabled).toBe(true);
    expect(config.agents['test']!.heartbeat.interval).toBe('30m');
    expect(config.agents['test']!.heartbeat.suppressOk).toBe(true);
    expect(config.agents['test']!.heartbeat.mode).toBe('check');
  });
});

describe('Environment Variable Expansion', () => {
  beforeEach(() => {
    process.env['TEST_TOKEN'] = 'my-secret-token';
    process.env['TEST_PORT'] = '9090';
  });

  afterEach(() => {
    delete process.env['TEST_TOKEN'];
    delete process.env['TEST_PORT'];
  });

  it('should expand ${VAR} in strings', () => {
    expect(expandEnvVars('token: ${TEST_TOKEN}')).toBe('token: my-secret-token');
  });

  it('should expand multiple variables', () => {
    const result = expandEnvVars('${TEST_TOKEN}:${TEST_PORT}');
    expect(result).toBe('my-secret-token:9090');
  });

  it('should replace unknown variables with empty string', () => {
    expect(expandEnvVars('${NONEXISTENT_VAR}')).toBe('');
  });

  it('should not modify strings without variables', () => {
    expect(expandEnvVars('plain text')).toBe('plain text');
  });

  it('should handle empty string', () => {
    expect(expandEnvVars('')).toBe('');
  });
});

describe('Config Load/Save Round-trip', () => {
  beforeEach(() => {
    process.env['CLADE_HOME'] = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    delete process.env['CLADE_HOME'];
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
  });

  it('should return default config when no file exists', () => {
    const config = loadConfig();
    // No pre-defined agents — starts empty
    expect(Object.keys(config.agents)).toHaveLength(0);
    expect(config.gateway.port).toBe(7890);
  });

  it('should save and reload config', () => {
    const config = generateDefaultConfig();
    saveConfig(config);
    expect(existsSync(getConfigPath())).toBe(true);

    const reloaded = loadConfig();
    expect(reloaded.gateway.port).toBe(config.gateway.port);
    expect(Object.keys(reloaded.agents)).toEqual(Object.keys(config.agents));
  });

  it('should save custom config and reload it', () => {
    const custom: Config = {
      ...generateDefaultConfig(),
      gateway: { port: 3000, host: '0.0.0.0' },
    };
    saveConfig(custom);

    const reloaded = loadConfig();
    expect(reloaded.gateway.port).toBe(3000);
    expect(reloaded.gateway.host).toBe('0.0.0.0');
  });
});

describe('Browser Config', () => {
  it('should default to enabled', () => {
    const config = ConfigSchema.parse({});
    expect(config.browser).toBeDefined();
    expect(config.browser.enabled).toBe(true);
  });

  it('should accept fully specified browser config', () => {
    const config = ConfigSchema.parse({
      browser: {
        enabled: true,
        userDataDir: '/custom/profile',
        browser: 'chrome',
        headless: false,
      },
    });
    expect(config.browser.enabled).toBe(true);
    expect(config.browser.userDataDir).toBe('/custom/profile');
    expect(config.browser.browser).toBe('chrome');
    expect(config.browser.headless).toBe(false);
  });

  it('should accept cdpEndpoint for persistent browser', () => {
    const config = ConfigSchema.parse({
      browser: {
        enabled: true,
        cdpEndpoint: 'ws://127.0.0.1:9222',
      },
    });
    expect(config.browser.cdpEndpoint).toBe('ws://127.0.0.1:9222');
  });

  it('should reject invalid browser type', () => {
    const result = ConfigSchema.safeParse({
      browser: { enabled: true, browser: 'safari' },
    });
    expect(result.success).toBe(false);
  });

  it('should apply browser defaults', () => {
    const config = ConfigSchema.parse({
      browser: { enabled: true },
    });
    expect(config.browser.browser).toBe('chromium');
    expect(config.browser.headless).toBe(false);
    expect(config.browser.cdpEndpoint).toBeUndefined();
    expect(config.browser.userDataDir).toBeUndefined();
  });
});

describe('Skills Config', () => {
  it('should default skills to empty object with autoApprove array', () => {
    const config = ConfigSchema.parse({});
    expect(config.skills).toBeDefined();
    expect(config.skills.autoApprove).toEqual([]);
  });

  it('should accept skills config with autoApprove list', () => {
    const config = ConfigSchema.parse({
      skills: { autoApprove: ['git-workflow', 'docker-helper'] },
    });
    expect(config.skills.autoApprove).toEqual(['git-workflow', 'docker-helper']);
  });

  it('should parse SkillsConfigSchema independently', () => {
    const result = SkillsConfigSchema.parse({});
    expect(result.autoApprove).toEqual([]);

    const withApprove = SkillsConfigSchema.parse({ autoApprove: ['test-skill'] });
    expect(withApprove.autoApprove).toEqual(['test-skill']);
  });

  it('should default agent skills to empty array', () => {
    const config = ConfigSchema.parse({
      agents: {
        test: { name: 'Test Agent' },
      },
    });
    expect(config.agents['test']!.skills).toEqual([]);
  });

  it('should accept agent with explicit skills list', () => {
    const config = ConfigSchema.parse({
      agents: {
        test: {
          name: 'Test Agent',
          skills: ['git-workflow', 'code-review'],
        },
      },
    });
    expect(config.agents['test']!.skills).toEqual(['git-workflow', 'code-review']);
  });

  it('should validate agent config with skills via AgentConfigSchema', () => {
    const agent = AgentConfigSchema.parse({
      name: 'Skill Agent',
      skills: ['debugging', 'testing'],
    });
    expect(agent.skills).toEqual(['debugging', 'testing']);
    expect(agent.mcp).toEqual([]); // mcp remains separate
  });

  it('should coexist skills and mcp in agent config', () => {
    const config = ConfigSchema.parse({
      agents: {
        hybrid: {
          name: 'Hybrid Agent',
          skills: ['git-workflow'],
          mcp: ['memory', 'sessions'],
        },
      },
    });
    expect(config.agents['hybrid']!.skills).toEqual(['git-workflow']);
    expect(config.agents['hybrid']!.mcp).toEqual(['memory', 'sessions']);
  });

  it('should coexist skills and mcp at root config level', () => {
    const config = ConfigSchema.parse({
      skills: { autoApprove: ['my-skill'] },
      mcp: { autoApprove: ['my-mcp'] },
    });
    expect(config.skills.autoApprove).toEqual(['my-skill']);
    expect(config.mcp.autoApprove).toEqual(['my-mcp']);
  });
});

describe('Config Migrations', () => {
  it('should report current schema version as 5', () => {
    expect(currentSchemaVersion()).toBe(5);
  });

  it('should migrate v3 config to v4 by adding skills', () => {
    const v3Config = {
      version: 3,
      agents: {
        main: { name: 'Main', mcp: ['memory'] },
      },
      mcp: { autoApprove: [] },
    };

    const { config, applied } = migrateConfig(v3Config);
    expect(config.version).toBe(5);
    expect(applied).toHaveLength(2);
    expect(applied[0]).toContain('skills');

    // Root-level skills config should be added
    expect(config.skills).toEqual({ autoApprove: [] });

    // Each agent should get an empty skills array
    const agents = config.agents as Record<string, Record<string, unknown>>;
    expect(agents['main']!.skills).toEqual([]);
    // mcp should be preserved
    expect(agents['main']!.mcp).toEqual(['memory']);
  });

  it('should migrate v4 config to v5 by adding backup', () => {
    const v4Config = {
      version: 4,
      agents: {
        main: { name: 'Main', skills: ['my-skill'], mcp: ['memory'] },
      },
      skills: { autoApprove: ['my-skill'] },
      mcp: { autoApprove: [] },
    };

    const { config, applied } = migrateConfig(v4Config);
    expect(applied).toHaveLength(1);
    expect(config.version).toBe(5);
    expect(config.backup).toEqual({
      enabled: false,
      repo: '',
      branch: 'main',
      intervalMinutes: 30,
      excludeChats: false,
    });
  });

  it('should migrate from v1 through v4', () => {
    const v1Config = {
      agents: {
        old: { name: 'Old Agent' },
      },
    };

    const { config, applied } = migrateConfig(v1Config);
    expect(config.version).toBe(5);
    expect(applied.length).toBeGreaterThanOrEqual(4);

    // Should have skills at root level
    expect(config.skills).toEqual({ autoApprove: [] });

    // Agent should have skills array
    const agents = config.agents as Record<string, Record<string, unknown>>;
    expect(agents['old']!.skills).toEqual([]);
  });
});

describe('Default Config Generation', () => {
  it('should generate a complete default config', () => {
    const config = generateDefaultConfig();
    expect(config.agents).toBeDefined();
    expect(config.channels).toBeDefined();
    expect(config.gateway).toBeDefined();
    expect(config.routing).toBeDefined();
    expect(config.mcp).toBeDefined();
    expect(config.skills).toBeDefined();
    expect(config.browser).toBeDefined();
  });

  it('should include skills in default config', () => {
    const config = generateDefaultConfig();
    expect(config.skills).toBeDefined();
    expect(config.skills.autoApprove).toEqual([]);
  });

  it('should have a default SOUL template', () => {
    expect(DEFAULT_SOUL).toContain('SOUL.md');
    expect(DEFAULT_SOUL.length).toBeGreaterThan(100);
  });

  it('should have a default HEARTBEAT template', () => {
    expect(DEFAULT_HEARTBEAT).toContain('Heartbeat');
    expect(DEFAULT_HEARTBEAT).toContain('HEARTBEAT_OK');
  });
});
