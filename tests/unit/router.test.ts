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
});
