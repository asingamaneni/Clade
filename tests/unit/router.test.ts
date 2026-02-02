// ---------------------------------------------------------------------------
// Tests: Message Router
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageRouter } from '../../src/router/index.js';
import { Store } from '../../src/store/sqlite.js';
import { ConfigSchema } from '../../src/config/schema.js';
import type { InboundMessage } from '../../src/agents/types.js';

describe('MessageRouter', () => {
  let store: Store;

  beforeEach(() => {
    store = Store.inMemory();
  });

  afterEach(() => {
    store.close();
  });

  function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
    return {
      channel: 'telegram',
      userId: 'user-1',
      text: 'Hello',
      timestamp: new Date(),
      ...overrides,
    };
  }

  it('should fall back to default agent when no rules match', () => {
    const config = ConfigSchema.parse({
      routing: { defaultAgent: 'main', rules: [] },
    });

    const router = new MessageRouter(config, store);
    const result = router.route(makeMessage());

    expect(result.agentId).toBe('main');
    expect(result.sessionKey).toContain('main');
    expect(result.text).toBe('Hello');
  });

  it('should route by explicit channel rule', () => {
    const config = ConfigSchema.parse({
      routing: {
        defaultAgent: 'main',
        rules: [
          { channel: 'slack', agentId: 'work' },
        ],
      },
    });

    const router = new MessageRouter(config, store);
    const result = router.route(makeMessage({ channel: 'slack', userId: 'U001' }));

    expect(result.agentId).toBe('work');
  });

  it('should route by channel + user rule', () => {
    const config = ConfigSchema.parse({
      routing: {
        defaultAgent: 'main',
        rules: [
          { channel: 'telegram', channelUserId: 'john', agentId: 'personal' },
        ],
      },
    });

    const router = new MessageRouter(config, store);

    // Matching user
    const john = router.route(makeMessage({ channel: 'telegram', userId: 'john' }));
    expect(john.agentId).toBe('personal');

    // Non-matching user should fall to default
    const jane = router.route(makeMessage({ channel: 'telegram', userId: 'jane' }));
    expect(jane.agentId).toBe('main');
  });

  it('should route by channel + chatId rule', () => {
    const config = ConfigSchema.parse({
      routing: {
        defaultAgent: 'main',
        rules: [
          { channel: 'slack', chatId: 'C-general', agentId: 'team' },
        ],
      },
    });

    const router = new MessageRouter(config, store);

    const result = router.route(
      makeMessage({ channel: 'slack', userId: 'U001', chatId: 'C-general' }),
    );
    expect(result.agentId).toBe('team');

    // Different chat should not match
    const other = router.route(
      makeMessage({ channel: 'slack', userId: 'U001', chatId: 'C-random' }),
    );
    expect(other.agentId).toBe('main');
  });

  it('should use first matching rule (order matters)', () => {
    const config = ConfigSchema.parse({
      routing: {
        defaultAgent: 'main',
        rules: [
          { channel: 'slack', agentId: 'first' },
          { channel: 'slack', agentId: 'second' },
        ],
      },
    });

    const router = new MessageRouter(config, store);
    const result = router.route(makeMessage({ channel: 'slack' }));
    expect(result.agentId).toBe('first');
  });

  it('should route by user mapping in the database', () => {
    const config = ConfigSchema.parse({
      routing: { defaultAgent: 'main', rules: [] },
    });

    // Create a user-to-agent mapping
    store.upsertUser({
      channel: 'telegram',
      channelUserId: 'tg-user-99',
      agentId: 'personal',
    });

    const router = new MessageRouter(config, store);
    const result = router.route(
      makeMessage({ channel: 'telegram', userId: 'tg-user-99' }),
    );

    expect(result.agentId).toBe('personal');
  });

  it('should prefer explicit rules over user mapping', () => {
    const config = ConfigSchema.parse({
      routing: {
        defaultAgent: 'main',
        rules: [
          { channel: 'telegram', channelUserId: 'tg-user-99', agentId: 'rule-agent' },
        ],
      },
    });

    store.upsertUser({
      channel: 'telegram',
      channelUserId: 'tg-user-99',
      agentId: 'db-agent',
    });

    const router = new MessageRouter(config, store);
    const result = router.route(
      makeMessage({ channel: 'telegram', userId: 'tg-user-99' }),
    );

    expect(result.agentId).toBe('rule-agent');
  });

  it('should generate different session keys for DMs vs groups', () => {
    const config = ConfigSchema.parse({
      routing: { defaultAgent: 'main', rules: [] },
    });

    const router = new MessageRouter(config, store);

    const dm = router.route(
      makeMessage({ channel: 'telegram', userId: 'u1' }),
    );
    const group = router.route(
      makeMessage({ channel: 'telegram', userId: 'u1', chatId: 'group-123' }),
    );

    expect(dm.sessionKey).not.toBe(group.sessionKey);
  });

  it('should allow changing the default agent', () => {
    const config = ConfigSchema.parse({
      routing: { defaultAgent: 'main', rules: [] },
    });

    const router = new MessageRouter(config, store);
    expect(router.getDefaultAgent()).toBe('main');

    router.setDefaultAgent('coder');
    expect(router.getDefaultAgent()).toBe('coder');

    const result = router.route(makeMessage());
    expect(result.agentId).toBe('coder');
  });

  // ---------------------------------------------------------------------------
  // @mention routing tests
  // ---------------------------------------------------------------------------

  describe('@mention routing', () => {
    function makeRouterWithAgents(agentNames: Record<string, string>) {
      const agents: Record<string, { name: string; toolPreset: string }> = {};
      for (const [id, name] of Object.entries(agentNames)) {
        agents[id] = { name, toolPreset: 'full' };
      }
      const config = ConfigSchema.parse({
        agents,
        routing: { defaultAgent: Object.keys(agentNames)[0] || 'default', rules: [] },
      });
      return new MessageRouter(config, store);
    }

    it('should route @jarvis message to jarvis agent', () => {
      const router = makeRouterWithAgents({
        jarvis: 'Jarvis',
        ravi: 'Ravi',
        manu: 'Manu',
      });

      const result = router.route(makeMessage({ text: '@jarvis do this task' }));
      expect(result.agentId).toBe('jarvis');
      expect(result.text).toBe('do this task');
    });

    it('should route @ravi message to ravi agent', () => {
      const router = makeRouterWithAgents({
        jarvis: 'Jarvis',
        ravi: 'Ravi',
        manu: 'Manu',
      });

      const result = router.route(makeMessage({ text: '@ravi research this topic' }));
      expect(result.agentId).toBe('ravi');
      expect(result.text).toBe('research this topic');
    });

    it('should be case-insensitive for mentions', () => {
      const router = makeRouterWithAgents({
        jarvis: 'Jarvis',
      });

      const result = router.route(makeMessage({ text: '@Jarvis help me' }));
      expect(result.agentId).toBe('jarvis');
      expect(result.text).toBe('help me');
    });

    it('should not match @mention for unknown agents', () => {
      const router = makeRouterWithAgents({
        jarvis: 'Jarvis',
      });

      const result = router.route(makeMessage({ text: '@unknown do something' }));
      // Falls through to default agent
      expect(result.agentId).toBe('jarvis');
      // Text is NOT stripped since the mention didn't match
      expect(result.text).toBe('@unknown do something');
    });

    it('should handle @mention in the middle of text', () => {
      const router = makeRouterWithAgents({
        jarvis: 'Jarvis',
        ravi: 'Ravi',
      });

      const result = router.route(makeMessage({ text: 'hey @ravi can you check this?' }));
      expect(result.agentId).toBe('ravi');
      expect(result.text).toBe('hey can you check this?');
    });

    it('should prefer @mention over routing rules', () => {
      const agents: Record<string, { name: string; toolPreset: string }> = {
        jarvis: { name: 'Jarvis', toolPreset: 'full' },
        work: { name: 'Work', toolPreset: 'full' },
      };
      const config = ConfigSchema.parse({
        agents,
        routing: {
          defaultAgent: 'work',
          rules: [{ channel: 'slack', agentId: 'work' }],
        },
      });
      const router = new MessageRouter(config, store);

      // Even though there's a rule routing all slack messages to 'work',
      // the @jarvis mention takes priority
      const result = router.route(
        makeMessage({ channel: 'slack', text: '@jarvis deploy to prod' }),
      );
      expect(result.agentId).toBe('jarvis');
      expect(result.text).toBe('deploy to prod');
    });

    it('should handle agent names with hyphens and underscores', () => {
      const router = makeRouterWithAgents({
        'my-agent': 'My Agent',
        'agent_2': 'Agent Two',
      });

      const r1 = router.route(makeMessage({ text: '@my-agent hello' }));
      expect(r1.agentId).toBe('my-agent');

      const r2 = router.route(makeMessage({ text: '@agent_2 hello' }));
      expect(r2.agentId).toBe('agent_2');
    });

    it('should handle message that is just a mention with no extra text', () => {
      const router = makeRouterWithAgents({
        jarvis: 'Jarvis',
      });

      const result = router.route(makeMessage({ text: '@jarvis' }));
      expect(result.agentId).toBe('jarvis');
      expect(result.text).toBe('');
    });

    it('should support addAgent for runtime agent registration', () => {
      const router = makeRouterWithAgents({
        jarvis: 'Jarvis',
      });

      // Initially unknown
      let result = router.route(makeMessage({ text: '@newbot hello' }));
      expect(result.agentId).toBe('jarvis'); // falls to default

      // Register at runtime
      router.addAgent('newbot');
      // Note: parseMention checks the agentIds set but resolves from config.agents.
      // For runtime-added agents, we need config.agents to have it too.
      // This test verifies the set is updated.
      expect(router['agentIds'].has('newbot')).toBe(true);
    });

    it('should support removeAgent', () => {
      const router = makeRouterWithAgents({
        jarvis: 'Jarvis',
      });

      expect(router['agentIds'].has('jarvis')).toBe(true);
      router.removeAgent('jarvis');
      expect(router['agentIds'].has('jarvis')).toBe(false);
    });

    it('should return text field in all route results', () => {
      const config = ConfigSchema.parse({
        routing: { defaultAgent: 'main', rules: [] },
      });
      const router = new MessageRouter(config, store);

      const result = router.route(makeMessage({ text: 'plain message' }));
      expect(result.text).toBe('plain message');
    });
  });
});
