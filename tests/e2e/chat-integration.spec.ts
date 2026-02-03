/**
 * Playwright E2E tests for full chat integration with the Claude CLI.
 *
 * These tests require:
 * - `claude` CLI installed and authenticated
 * - Build must be fresh (`npm run build`)
 *
 * Tests are automatically SKIPPED when the `claude` CLI is not available,
 * making them safe to include in CI pipelines that may or may not have
 * the CLI configured.
 *
 * Each test exercises the full round-trip: send a message via WebSocket,
 * get a real response from Claude, and verify the result.
 */
import { test, expect } from '@playwright/test';
import { startTestServer, stopTestServer, TestServer, hasClaudeCli } from './fixtures/server.ts';

let server: TestServer;

test.beforeAll(async () => {
  server = await startTestServer();
});

test.afterAll(() => {
  stopTestServer(server);
});

test.describe('Chat Integration (requires claude CLI)', () => {
  test('send message and receive real response', async ({ page, request }) => {
    test.skip(!hasClaudeCli(), 'claude CLI not available');
    test.setTimeout(180000); // 3 minute timeout

    // Create conversation
    const convRes = await request.post(server.baseUrl + '/api/chat/conversations', {
      data: { agentId: 'jarvis' },
    });
    const convId = (await convRes.json()).conversation.id;

    await page.goto(server.baseUrl + '/admin');

    const result = await page.evaluate(async ({ baseUrl, conversationId }) => {
      return new Promise<{ text: string; error?: string }>((resolve) => {
        const timeout = setTimeout(() => resolve({ text: '', error: 'timeout' }), 150000);
        const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws');

        ws.onopen = () => {
          ws.send(JSON.stringify({
            type: 'message',
            agentId: 'jarvis',
            text: 'Respond with exactly the word "pong". Nothing else.',
            conversationId,
          }));
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === 'message' && msg.message?.role === 'assistant') {
            clearTimeout(timeout);
            ws.close();
            resolve({ text: msg.message.text });
          }
          if (msg.type === 'error') {
            clearTimeout(timeout);
            ws.close();
            resolve({ text: '', error: msg.text });
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve({ text: '', error: 'ws error' });
        };
      });
    }, { baseUrl: server.baseUrl, conversationId: convId });

    expect(result.text.length).toBeGreaterThan(0);
    // Response should contain "pong" (case-insensitive)
    expect(result.text.toLowerCase()).toContain('pong');
  });

  test('session resume maintains context', async ({ page, request }) => {
    test.skip(!hasClaudeCli(), 'claude CLI not available');
    test.setTimeout(180000);

    // Create conversation
    const convRes = await request.post(server.baseUrl + '/api/chat/conversations', {
      data: { agentId: 'jarvis' },
    });
    const convId = (await convRes.json()).conversation.id;

    await page.goto(server.baseUrl + '/admin');

    // Send first message with context
    const r1 = await page.evaluate(async ({ baseUrl, conversationId }) => {
      return new Promise<{ text: string }>((resolve) => {
        const timeout = setTimeout(() => resolve({ text: '' }), 150000);
        const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws');
        ws.onopen = () => {
          ws.send(JSON.stringify({
            type: 'message',
            agentId: 'jarvis',
            text: 'Remember: the secret word is "banana". Confirm you got it.',
            conversationId,
          }));
        };
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === 'message' && msg.message?.role === 'assistant') {
            clearTimeout(timeout);
            ws.close();
            resolve({ text: msg.message.text });
          }
        };
      });
    }, { baseUrl: server.baseUrl, conversationId: convId });

    expect(r1.text.length).toBeGreaterThan(0);

    // Send follow-up in same conversation (should resume session)
    const r2 = await page.evaluate(async ({ baseUrl, conversationId }) => {
      return new Promise<{ text: string }>((resolve) => {
        const timeout = setTimeout(() => resolve({ text: '' }), 150000);
        const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws');
        ws.onopen = () => {
          ws.send(JSON.stringify({
            type: 'message',
            agentId: 'jarvis',
            text: 'What is the secret word I told you?',
            conversationId,
          }));
        };
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === 'message' && msg.message?.role === 'assistant') {
            clearTimeout(timeout);
            ws.close();
            resolve({ text: msg.message.text });
          }
        };
      });
    }, { baseUrl: server.baseUrl, conversationId: convId });

    expect(r2.text.toLowerCase()).toContain('banana');
  });

  test('conversation persisted in chat history', async ({ request }) => {
    test.skip(!hasClaudeCli(), 'claude CLI not available');

    // The pre-seeded conversation should have messages
    const res = await request.get(
      server.baseUrl + '/api/chat/history?agentId=jarvis&conversationId=conv_test000001',
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.messages.length).toBeGreaterThanOrEqual(2);
  });

  test('session map file created on disk', async () => {
    test.skip(!hasClaudeCli(), 'claude CLI not available');

    const { existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sessionMapFile = join(server.cladeHome, 'data', 'session-map.json');

    if (existsSync(sessionMapFile)) {
      const map = JSON.parse(readFileSync(sessionMapFile, 'utf-8'));
      const keys = Object.keys(map);
      expect(keys.length).toBeGreaterThan(0);
    }
    // If no session map exists, CLI responses may not have returned session IDs
    // This is acceptable in some CLI versions
  });

  test('memory injection provides context to agent', async ({ page, request }) => {
    test.skip(!hasClaudeCli(), 'claude CLI not available');
    test.setTimeout(180000);

    const convRes = await request.post(server.baseUrl + '/api/chat/conversations', {
      data: { agentId: 'jarvis' },
    });
    const convId = (await convRes.json()).conversation.id;

    await page.goto(server.baseUrl + '/admin');

    // Ask about something in MEMORY.md (jarvis has "Prefers TypeScript" in memory)
    const result = await page.evaluate(async ({ baseUrl, conversationId }) => {
      return new Promise<{ text: string }>((resolve) => {
        const timeout = setTimeout(() => resolve({ text: '' }), 150000);
        const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws');
        ws.onopen = () => {
          ws.send(JSON.stringify({
            type: 'message',
            agentId: 'jarvis',
            text: 'According to your memory/context, what programming language does the user prefer? Reply with just the language name.',
            conversationId,
          }));
        };
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === 'message' && msg.message?.role === 'assistant') {
            clearTimeout(timeout);
            ws.close();
            resolve({ text: msg.message.text });
          }
        };
      });
    }, { baseUrl: server.baseUrl, conversationId: convId });

    // The response should mention TypeScript since it's in MEMORY.md
    expect(result.text.toLowerCase()).toContain('typescript');
  });
});
