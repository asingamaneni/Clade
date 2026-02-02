// ---------------------------------------------------------------------------
// Tests: Configuration system
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigSchema } from '../../src/config/schema.js';
import {
  loadConfig,
  saveConfig,
  expandEnvVars,
  getConfigDir,
  getConfigPath,
} from '../../src/config/index.js';
import { generateDefaultConfig, DEFAULT_SOUL, DEFAULT_HEARTBEAT } from '../../src/config/defaults.js';
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
    expect(config.version).toBe(2);
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
          skills: ['memory'],
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
      skills: { autoApprove: ['memory'] },
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

describe('Default Config Generation', () => {
  it('should generate a complete default config', () => {
    const config = generateDefaultConfig();
    expect(config.agents).toBeDefined();
    expect(config.channels).toBeDefined();
    expect(config.gateway).toBeDefined();
    expect(config.routing).toBeDefined();
    expect(config.skills).toBeDefined();
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
