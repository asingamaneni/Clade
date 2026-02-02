// ---------------------------------------------------------------------------
// Tests: Claude CLI Compatibility Layer
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClaudeCapabilities, CliOptions, CompatibilityResult } from '../../src/engine/compat.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('child_process', () => {
  return {
    execSync: vi.fn(),
  };
});

vi.mock('fs', () => {
  return {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);

import {
  detectCapabilities,
  getMinimumVersion,
  checkCompatibility,
  buildCliArgs,
  exportAsPlugin,
  _resetCachedCapabilities,
} from '../../src/engine/compat.js';

// ---------------------------------------------------------------------------
// Help output fixtures
// ---------------------------------------------------------------------------

const FULL_HELP_OUTPUT = `
Usage: claude [options] [prompt]

Options:
  -p, --prompt <text>                  Provide a prompt
  --output-format <format>             Output format (text, json, stream-json)
  --resume <session_id>                Resume a previous session
  --append-system-prompt <text>        Append to the system prompt
  --append-system-prompt-file <path>   Append file contents to system prompt
  --allowedTools <tools>               Comma-separated list of allowed tools
  --mcp-config <path>                  Path to MCP server config
  --max-turns <n>                      Maximum number of turns
  --model <model>                      Model to use
  --plugins <dir>                      Load plugins from directory
  --agents <json>                      Inline subagent definitions
  --mcp-tool-search                    Enable MCP lazy tool loading
  --verbose                            Verbose output
  -h, --help                           Display help
`;

const MINIMAL_HELP_OUTPUT = `
Usage: claude [options] [prompt]

Options:
  -p, --prompt <text>                  Provide a prompt
  --output-format <format>             Output format (text, json, stream-json)
  --resume <session_id>                Resume a previous session
  --append-system-prompt <text>        Append to the system prompt
  --allowedTools <tools>               Comma-separated list of allowed tools
  --mcp-config <path>                  Path to MCP server config
  --max-turns <n>                      Maximum number of turns
  --model <model>                      Model to use
  --verbose                            Verbose output
  -h, --help                           Display help
`;

const VERY_OLD_HELP_OUTPUT = `
Usage: claude [options] [prompt]

Options:
  -p, --prompt <text>                  Provide a prompt
  --output-format <format>             Output format (text, json)
  --append-system-prompt <text>        Append to the system prompt
  --model <model>                      Model to use
  --verbose                            Verbose output
  -h, --help                           Display help
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Configure mockExecSync to return specific outputs for --version and --help.
 */
function setupExecMock(versionOutput: string, helpOutput: string): void {
  mockExecSync.mockImplementation((cmd: string) => {
    const command = typeof cmd === 'string' ? cmd : String(cmd);
    if (command.includes('--version')) return versionOutput;
    if (command.includes('--help')) return helpOutput;
    return '';
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Claude CLI Compatibility Layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCachedCapabilities();
  });

  // =========================================================================
  // detectCapabilities
  // =========================================================================

  describe('detectCapabilities', () => {
    it('should detect all capabilities for a fully-featured CLI', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const caps = detectCapabilities();

      expect(caps.version).toBe('1.5.0');
      expect(caps.hasPlugins).toBe(true);
      expect(caps.hasAgentsFlag).toBe(true);
      expect(caps.hasAppendSystemPromptFile).toBe(true);
      expect(caps.hasMcpToolSearch).toBe(true);
      expect(caps.hasStreamJson).toBe(true);
      expect(caps.hasResume).toBe(true);
      expect(caps.hasMaxTurns).toBe(true);
      expect(caps.hasAllowedTools).toBe(true);
      expect(caps.hasMcpConfig).toBe(true);
      expect(caps.hasModel).toBe(true);
    });

    it('should detect limited capabilities for a minimal CLI', () => {
      setupExecMock('claude 1.0.3\n', MINIMAL_HELP_OUTPUT);

      const caps = detectCapabilities();

      expect(caps.version).toBe('1.0.3');
      expect(caps.hasPlugins).toBe(false);
      expect(caps.hasAgentsFlag).toBe(false);
      expect(caps.hasAppendSystemPromptFile).toBe(false);
      expect(caps.hasMcpToolSearch).toBe(false);
      expect(caps.hasStreamJson).toBe(true);
      expect(caps.hasResume).toBe(true);
      expect(caps.hasMaxTurns).toBe(true);
      expect(caps.hasAllowedTools).toBe(true);
      expect(caps.hasMcpConfig).toBe(true);
      expect(caps.hasModel).toBe(true);
    });

    it('should detect missing core capabilities in very old CLI', () => {
      setupExecMock('0.8.0', VERY_OLD_HELP_OUTPUT);

      const caps = detectCapabilities();

      expect(caps.version).toBe('0.8.0');
      expect(caps.hasResume).toBe(false);
      expect(caps.hasMaxTurns).toBe(false);
      expect(caps.hasAllowedTools).toBe(false);
      expect(caps.hasMcpConfig).toBe(false);
      expect(caps.hasPlugins).toBe(false);
      expect(caps.hasAgentsFlag).toBe(false);
      expect(caps.hasAppendSystemPromptFile).toBe(false);
      expect(caps.hasMcpToolSearch).toBe(false);
      // --output-format is present but without stream-json text in help
      expect(caps.hasStreamJson).toBe(true); // flag is present
      expect(caps.hasModel).toBe(true);
    });

    it('should return unknown version when CLI is not installed', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('command not found: claude');
      });

      const caps = detectCapabilities();

      expect(caps.version).toBe('unknown');
      expect(caps.hasStreamJson).toBe(false);
      expect(caps.hasResume).toBe(false);
      expect(caps.hasPlugins).toBe(false);
    });

    it('should handle version with "v" prefix', () => {
      setupExecMock('claude v2.1.0\n', FULL_HELP_OUTPUT);

      const caps = detectCapabilities();
      expect(caps.version).toBe('2.1.0');
    });

    it('should handle version with only numbers', () => {
      setupExecMock('1.2.3\n', MINIMAL_HELP_OUTPUT);

      const caps = detectCapabilities();
      expect(caps.version).toBe('1.2.3');
    });

    it('should handle version with prerelease suffix', () => {
      setupExecMock('claude 1.3.0-beta.1\n', FULL_HELP_OUTPUT);

      const caps = detectCapabilities();
      expect(caps.version).toBe('1.3.0-beta.1');
    });

    it('should cache capabilities across multiple calls', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const first = detectCapabilities();
      const second = detectCapabilities();

      expect(first).toBe(second); // Same reference (cached)
      // execSync should only be called twice (once for --version, once for --help)
      expect(mockExecSync).toHaveBeenCalledTimes(2);
    });

    it('should handle --help failure gracefully', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command.includes('--version')) return 'claude 1.0.0\n';
        if (command.includes('--help')) throw new Error('help failed');
        return '';
      });

      const caps = detectCapabilities();

      expect(caps.version).toBe('1.0.0');
      // All flags should be false since --help failed
      expect(caps.hasStreamJson).toBe(false);
      expect(caps.hasResume).toBe(false);
      expect(caps.hasPlugins).toBe(false);
    });

    it('should detect --allowed-tools (kebab-case variant)', () => {
      const helpWithKebab = `
Usage: claude [options]
Options:
  --allowed-tools <tools>   Allowed tools list
  --output-format <format>  Output format
  --resume <id>             Resume session
  --model <model>           Model
`;
      setupExecMock('claude 1.1.0\n', helpWithKebab);

      const caps = detectCapabilities();
      expect(caps.hasAllowedTools).toBe(true);
    });
  });

  // =========================================================================
  // getMinimumVersion
  // =========================================================================

  describe('getMinimumVersion', () => {
    it('should return a valid semver string', () => {
      const version = getMinimumVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should return 1.0.0', () => {
      expect(getMinimumVersion()).toBe('1.0.0');
    });
  });

  // =========================================================================
  // checkCompatibility
  // =========================================================================

  describe('checkCompatibility', () => {
    it('should report compatible for a fully-featured CLI', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const result = checkCompatibility();

      expect(result.compatible).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should report compatible with warnings for CLI missing optional features', () => {
      setupExecMock('claude 1.0.3\n', MINIMAL_HELP_OUTPUT);

      const result = checkCompatibility();

      expect(result.compatible).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);

      // Check specific warnings
      const warningText = result.warnings.join(' ');
      expect(warningText).toContain('--plugins');
      expect(warningText).toContain('--agents');
      expect(warningText).toContain('MCP lazy tool loading');
    });

    it('should report incompatible when CLI is not installed', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('command not found: claude');
      });

      const result = checkCompatibility();

      expect(result.compatible).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('not installed');
    });

    it('should report errors for CLI below minimum version', () => {
      setupExecMock('claude 0.5.0\n', MINIMAL_HELP_OUTPUT);

      const result = checkCompatibility();

      const errorText = result.errors.join(' ');
      expect(errorText).toContain('0.5.0');
      expect(errorText).toContain('below the minimum');
    });

    it('should report error when stream-json is not supported', () => {
      // Help output without --output-format and without stream-json
      const noStreamHelp = `
Usage: claude [options]
Options:
  --resume <id>                Resume session
  --append-system-prompt <t>   System prompt
  --model <model>              Model
`;
      setupExecMock('claude 1.0.0\n', noStreamHelp);

      const result = checkCompatibility();

      expect(result.compatible).toBe(false);
      const errorText = result.errors.join(' ');
      expect(errorText).toContain('stream-json');
    });

    it('should report error when --resume is not supported', () => {
      const noResumeHelp = `
Usage: claude [options]
Options:
  --output-format <format>     Output format (stream-json)
  --append-system-prompt <t>   System prompt
  --model <model>              Model
`;
      setupExecMock('claude 1.0.0\n', noResumeHelp);

      const result = checkCompatibility();

      expect(result.compatible).toBe(false);
      const errorText = result.errors.join(' ');
      expect(errorText).toContain('--resume');
    });

    it('should generate both errors and warnings as appropriate', () => {
      // A CLI that has stream-json and resume but nothing else
      const partialHelp = `
Usage: claude [options]
Options:
  --output-format <format>     Output format (stream-json)
  --resume <id>                Resume session
  --append-system-prompt <t>   System prompt
  --model <model>              Model
`;
      setupExecMock('claude 1.0.0\n', partialHelp);

      const result = checkCompatibility();

      // Should be compatible (critical features present)
      expect(result.compatible).toBe(true);
      // Should have warnings for missing optional features
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // buildCliArgs
  // =========================================================================

  describe('buildCliArgs', () => {
    it('should build basic args with prompt and default stream-json', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const args = buildCliArgs({ prompt: 'Hello world' });

      expect(args).toContain('-p');
      expect(args).toContain('Hello world');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
    });

    it('should include --resume when sessionId is provided and supported', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'Continue',
        sessionId: 'sess-abc',
      });

      expect(args).toContain('--resume');
      expect(args).toContain('sess-abc');
    });

    it('should omit --resume when not supported', () => {
      setupExecMock('claude 0.8.0\n', VERY_OLD_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'Continue',
        sessionId: 'sess-abc',
      });

      expect(args).not.toContain('--resume');
      expect(args).not.toContain('sess-abc');
    });

    it('should use --append-system-prompt-file when available and file provided', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'test',
        appendSystemPromptFile: '/path/to/soul.md',
      });

      expect(args).toContain('--append-system-prompt-file');
      expect(args).toContain('/path/to/soul.md');
      expect(args).not.toContain('--append-system-prompt');
    });

    it('should fall back to --append-system-prompt with file content when file flag is unavailable', () => {
      setupExecMock('claude 1.0.3\n', MINIMAL_HELP_OUTPUT);
      mockReadFileSync.mockReturnValue('Soul content from file');

      const args = buildCliArgs({
        prompt: 'test',
        appendSystemPromptFile: '/path/to/soul.md',
      });

      expect(args).not.toContain('--append-system-prompt-file');
      expect(args).toContain('--append-system-prompt');
      expect(args).toContain('Soul content from file');
    });

    it('should fall back to appendSystemPrompt when file read fails', () => {
      setupExecMock('claude 1.0.3\n', MINIMAL_HELP_OUTPUT);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const args = buildCliArgs({
        prompt: 'test',
        appendSystemPromptFile: '/nonexistent/soul.md',
        appendSystemPrompt: 'Inline soul content',
      });

      expect(args).toContain('--append-system-prompt');
      expect(args).toContain('Inline soul content');
    });

    it('should include --append-system-prompt when only inline prompt provided', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'test',
        appendSystemPrompt: 'Be helpful',
      });

      expect(args).toContain('--append-system-prompt');
      expect(args).toContain('Be helpful');
    });

    it('should include --allowedTools when supported', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'test',
        allowedTools: ['Read', 'Edit', 'Bash'],
      });

      expect(args).toContain('--allowedTools');
      expect(args).toContain('Read,Edit,Bash');
    });

    it('should omit --allowedTools when not supported', () => {
      setupExecMock('claude 0.8.0\n', VERY_OLD_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'test',
        allowedTools: ['Read', 'Edit'],
      });

      expect(args).not.toContain('--allowedTools');
    });

    it('should include --mcp-config when supported', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'test',
        mcpConfig: '/path/to/mcp.json',
      });

      expect(args).toContain('--mcp-config');
      expect(args).toContain('/path/to/mcp.json');
    });

    it('should omit --mcp-config when not supported', () => {
      setupExecMock('claude 0.8.0\n', VERY_OLD_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'test',
        mcpConfig: '/path/to/mcp.json',
      });

      expect(args).not.toContain('--mcp-config');
    });

    it('should include --max-turns when supported', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'test',
        maxTurns: 10,
      });

      expect(args).toContain('--max-turns');
      expect(args).toContain('10');
    });

    it('should omit --max-turns when not supported', () => {
      setupExecMock('claude 0.8.0\n', VERY_OLD_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'test',
        maxTurns: 10,
      });

      expect(args).not.toContain('--max-turns');
    });

    it('should include --model when supported', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'test',
        model: 'opus',
      });

      expect(args).toContain('--model');
      expect(args).toContain('opus');
    });

    it('should include --agents when supported and agents provided', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const agents = {
        researcher: {
          description: 'Research assistant',
          prompt: 'You are a research assistant',
          tools: ['WebSearch'],
          model: 'sonnet',
        },
      };

      const args = buildCliArgs({
        prompt: 'test',
        agents,
      });

      expect(args).toContain('--agents');
      const agentsArgIndex = args.indexOf('--agents');
      const agentsJson = args[agentsArgIndex + 1];
      expect(agentsJson).toBeDefined();
      expect(JSON.parse(agentsJson!)).toEqual(agents);
    });

    it('should omit --agents when not supported', () => {
      setupExecMock('claude 1.0.3\n', MINIMAL_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'test',
        agents: {
          helper: {
            description: 'Helper',
            prompt: 'Help',
          },
        },
      });

      expect(args).not.toContain('--agents');
    });

    it('should respect explicit output format', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const jsonArgs = buildCliArgs({
        prompt: 'test',
        outputFormat: 'json',
      });
      expect(jsonArgs).toContain('--output-format');
      expect(jsonArgs).toContain('json');

      _resetCachedCapabilities();
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const textArgs = buildCliArgs({
        prompt: 'test',
        outputFormat: 'text',
      });
      expect(textArgs).toContain('--output-format');
      expect(textArgs).toContain('text');
    });

    it('should not include maxTurns of 0 or negative', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'test',
        maxTurns: 0,
      });

      expect(args).not.toContain('--max-turns');
    });

    it('should handle empty allowedTools array', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'test',
        allowedTools: [],
      });

      expect(args).not.toContain('--allowedTools');
    });

    it('should build a comprehensive arg list with all options', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'Do work',
        sessionId: 'sess-123',
        appendSystemPrompt: 'Be helpful',
        allowedTools: ['Read', 'Bash'],
        mcpConfig: '/mcp.json',
        maxTurns: 25,
        model: 'opus',
        outputFormat: 'stream-json',
      });

      expect(args).toEqual(expect.arrayContaining([
        '-p', 'Do work',
        '--output-format', 'stream-json',
        '--resume', 'sess-123',
        '--append-system-prompt', 'Be helpful',
        '--allowedTools', 'Read,Bash',
        '--mcp-config', '/mcp.json',
        '--max-turns', '25',
        '--model', 'opus',
      ]));
    });
  });

  // =========================================================================
  // exportAsPlugin
  // =========================================================================

  describe('exportAsPlugin', () => {
    it('should throw when plugins capability is not available', () => {
      setupExecMock('claude 1.0.3\n', MINIMAL_HELP_OUTPUT);

      expect(() => exportAsPlugin('test-agent', '/tmp/output')).toThrow(
        'does not support --plugins',
      );
    });

    it('should create the correct directory structure', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);
      mockExistsSync.mockReturnValue(false);

      exportAsPlugin('my-agent', '/tmp/plugin-output');

      // Verify directories were created
      expect(mockMkdirSync).toHaveBeenCalledWith(
        '/tmp/plugin-output/.claude-plugin',
        { recursive: true },
      );
      expect(mockMkdirSync).toHaveBeenCalledWith(
        '/tmp/plugin-output/agents',
        { recursive: true },
      );

      // Verify files were written
      const writeArgs = mockWriteFileSync.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(writeArgs).toContain('/tmp/plugin-output/.claude-plugin/plugin.json');
      expect(writeArgs).toContain('/tmp/plugin-output/agents/my-agent.md');
      expect(writeArgs).toContain('/tmp/plugin-output/.mcp.json');
    });

    it('should write valid plugin.json', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);
      mockExistsSync.mockReturnValue(false);

      exportAsPlugin('test-agent', '/tmp/output');

      const pluginJsonCall = mockWriteFileSync.mock.calls.find(
        (call) => (call[0] as string).endsWith('plugin.json'),
      );
      expect(pluginJsonCall).toBeDefined();

      const pluginJson = JSON.parse(
        (pluginJsonCall![1] as string).trim(),
      ) as Record<string, unknown>;
      expect(pluginJson).toHaveProperty('name', 'test-agent');
      expect(pluginJson).toHaveProperty('version', '1.0.0');
      expect(pluginJson).toHaveProperty('description');
    });

    it('should write agent markdown with YAML frontmatter', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      // Make SOUL.md exist
      mockExistsSync.mockImplementation((p: unknown) => {
        const path = String(p);
        return path.endsWith('SOUL.md');
      });
      mockReadFileSync.mockImplementation((p: unknown) => {
        const path = String(p);
        if (path.endsWith('SOUL.md')) return '# My Agent Soul\n\nBe kind.';
        return '';
      });

      exportAsPlugin('my-agent', '/tmp/output');

      const agentMdCall = mockWriteFileSync.mock.calls.find(
        (call) => (call[0] as string).endsWith('my-agent.md'),
      );
      expect(agentMdCall).toBeDefined();

      const content = agentMdCall![1] as string;
      expect(content).toContain('---');
      expect(content).toContain('model:');
      expect(content).toContain('# My Agent Soul');
      expect(content).toContain('Be kind.');
    });

    it('should write .mcp.json file', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);
      mockExistsSync.mockReturnValue(false);

      exportAsPlugin('test-agent', '/tmp/output');

      const mcpJsonCall = mockWriteFileSync.mock.calls.find(
        (call) => (call[0] as string).endsWith('.mcp.json'),
      );
      expect(mcpJsonCall).toBeDefined();

      // Should be valid JSON
      const mcpJson = JSON.parse(
        (mcpJsonCall![1] as string).trim(),
      ) as Record<string, unknown>;
      expect(mcpJson).toBeDefined();
    });

    it('should read existing mcp.json from agent directory if present', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const mcpConfig = {
        mcpServers: {
          memory: { command: 'node', args: ['memory-server.js'] },
        },
      };

      mockExistsSync.mockImplementation((p: unknown) => {
        const path = String(p);
        return path.endsWith('mcp.json');
      });
      mockReadFileSync.mockImplementation((p: unknown) => {
        const path = String(p);
        if (path.endsWith('mcp.json')) return JSON.stringify(mcpConfig);
        return '';
      });

      exportAsPlugin('test-agent', '/tmp/output');

      const mcpJsonCall = mockWriteFileSync.mock.calls.find(
        (call) => (call[0] as string) === '/tmp/output/.mcp.json',
      );
      expect(mcpJsonCall).toBeDefined();

      const writtenMcp = JSON.parse(
        (mcpJsonCall![1] as string).trim(),
      ) as Record<string, unknown>;
      expect(writtenMcp).toEqual(mcpConfig);
    });

    it('should read agent config from config.json when available', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const configJson = {
        agents: {
          'my-agent': {
            model: 'opus',
            description: 'A test agent',
            customTools: ['Read', 'Edit'],
          },
        },
      };

      mockExistsSync.mockImplementation((p: unknown) => {
        const filePath = String(p);
        return filePath.endsWith('config.json');
      });
      mockReadFileSync.mockImplementation((p: unknown) => {
        const filePath = String(p);
        if (filePath.endsWith('config.json')) return JSON.stringify(configJson);
        return '';
      });

      exportAsPlugin('my-agent', '/tmp/output');

      // Check plugin.json has the description from config
      const pluginJsonCall = mockWriteFileSync.mock.calls.find(
        (call) => (call[0] as string).endsWith('plugin.json'),
      );
      expect(pluginJsonCall).toBeDefined();
      const pluginJson = JSON.parse(
        (pluginJsonCall![1] as string).trim(),
      ) as Record<string, string>;
      expect(pluginJson.description).toBe('A test agent');

      // Check agent markdown has the model and tools from config
      const agentMdCall = mockWriteFileSync.mock.calls.find(
        (call) => (call[0] as string).endsWith('my-agent.md'),
      );
      expect(agentMdCall).toBeDefined();
      const agentContent = agentMdCall![1] as string;
      expect(agentContent).toContain('model: opus');
      expect(agentContent).toContain('tools:');
      expect(agentContent).toContain('  - Read');
      expect(agentContent).toContain('  - Edit');
    });
  });

  // =========================================================================
  // _resetCachedCapabilities
  // =========================================================================

  describe('_resetCachedCapabilities', () => {
    it('should allow re-detection after reset', () => {
      setupExecMock('claude 1.0.0\n', MINIMAL_HELP_OUTPUT);

      const first = detectCapabilities();
      expect(first.version).toBe('1.0.0');

      _resetCachedCapabilities();

      setupExecMock('claude 2.0.0\n', FULL_HELP_OUTPUT);

      const second = detectCapabilities();
      expect(second.version).toBe('2.0.0');
      expect(second.hasPlugins).toBe(true);
    });
  });

  // =========================================================================
  // Integration-style: buildCliArgs fallback combinations
  // =========================================================================

  describe('buildCliArgs fallback combinations', () => {
    it('should prefer appendSystemPromptFile over inline when both provided and file flag supported', () => {
      setupExecMock('claude 1.5.0\n', FULL_HELP_OUTPUT);

      const args = buildCliArgs({
        prompt: 'test',
        appendSystemPrompt: 'Inline content',
        appendSystemPromptFile: '/path/to/file.md',
      });

      expect(args).toContain('--append-system-prompt-file');
      expect(args).toContain('/path/to/file.md');
      // Should NOT also include inline prompt
      const appendIdx = args.indexOf('--append-system-prompt');
      expect(appendIdx).toBe(-1);
    });

    it('should use inline content from file when file flag not supported', () => {
      setupExecMock('claude 1.0.3\n', MINIMAL_HELP_OUTPUT);
      mockReadFileSync.mockReturnValue('File-based soul content');

      const args = buildCliArgs({
        prompt: 'test',
        appendSystemPrompt: 'Inline fallback',
        appendSystemPromptFile: '/path/to/file.md',
      });

      expect(args).not.toContain('--append-system-prompt-file');
      expect(args).toContain('--append-system-prompt');
      expect(args).toContain('File-based soul content');
    });

    it('should gracefully degrade when no capabilities are available', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const args = buildCliArgs({
        prompt: 'Hello',
        sessionId: 'sess-1',
        appendSystemPrompt: 'Be nice',
        allowedTools: ['Read'],
        mcpConfig: '/mcp.json',
        maxTurns: 5,
        model: 'opus',
        outputFormat: 'stream-json',
      });

      // Should always include -p and prompt
      expect(args).toContain('-p');
      expect(args).toContain('Hello');

      // Capability-gated flags should be omitted
      expect(args).not.toContain('--resume');
      // --append-system-prompt is always included when content is provided (fundamental feature)
      expect(args).toContain('--append-system-prompt');
      expect(args).toContain('Be nice');
      expect(args).not.toContain('--allowedTools');
      expect(args).not.toContain('--mcp-config');
      expect(args).not.toContain('--max-turns');
      expect(args).not.toContain('--model');
      expect(args).not.toContain('--output-format');
    });
  });
});
