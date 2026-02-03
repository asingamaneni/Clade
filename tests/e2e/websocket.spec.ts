/**
 * Playwright E2E tests for WebSocket infrastructure.
 *
 * Validates both /ws/admin and /ws endpoints:
 * - Connection establishment and handshake frames
 * - Message acknowledgement flow
 * - Typing indicators
 * - Error handling (unknown agent, malformed JSON)
 * - Unique client ID generation
 * - Connection persistence after sends
 *
 * Uses page.evaluate() to run WebSocket code in the browser context
 * since Playwright's request context does not support WebSocket.
 */
import { test, expect } from '@playwright/test';
import { startTestServer, stopTestServer, TestServer } from './fixtures/server.ts';

let server: TestServer;

test.beforeAll(async () => {
  server = await startTestServer();
});

test.afterAll(() => {
  stopTestServer(server);
});

test.describe('WebSocket Infrastructure', () => {
  test('/ws/admin connects successfully', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin', { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async (baseUrl) => {
      return new Promise<{ connected: boolean; readyState: number }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ connected: false, readyState: -1 });
        }, 10000);

        const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws/admin');

        ws.onopen = () => {
          clearTimeout(timeout);
          const readyState = ws.readyState;
          ws.close();
          resolve({ connected: true, readyState });
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve({ connected: false, readyState: ws.readyState });
        };
      });
    }, server.baseUrl);

    expect(result.connected).toBe(true);
    expect(result.readyState).toBe(1); // WebSocket.OPEN
  });

  test('/ws connects and receives connected event', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin', { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async (baseUrl) => {
      return new Promise<{ type: string | null; clientId: string | null; hasPrefix: boolean }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ type: null, clientId: null, hasPrefix: false });
        }, 10000);

        const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws');

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            clearTimeout(timeout);
            ws.close();
            resolve({
              type: data.type ?? null,
              clientId: data.clientId ?? null,
              hasPrefix: typeof data.clientId === 'string' && data.clientId.startsWith('client_'),
            });
          } catch {
            clearTimeout(timeout);
            ws.close();
            resolve({ type: null, clientId: null, hasPrefix: false });
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve({ type: null, clientId: null, hasPrefix: false });
        };
      });
    }, server.baseUrl);

    expect(result.type).toBe('connected');
    expect(result.clientId).toBeTruthy();
    expect(result.hasPrefix).toBe(true);
  });

  test('/ws sends message_ack for valid message', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin', { waitUntil: 'domcontentloaded' });

    // Create a conversation via API first
    const convRes = await page.request.post(server.baseUrl + '/api/chat/conversations', {
      data: { agentId: 'jarvis' },
    });
    const convData = await convRes.json();
    const conversationId = convData.conversation?.id;
    expect(conversationId).toBeTruthy();

    const result = await page.evaluate(async ({ baseUrl, conversationId }) => {
      return new Promise<{ gotAck: boolean; ackRole: string | null; ackConvId: string | null }>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ gotAck: false, ackRole: null, ackConvId: null });
        }, 5000);

        const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws');
        let sentMessage = false;

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            // After connected handshake, send our message
            if (data.type === 'connected' && !sentMessage) {
              sentMessage = true;
              ws.send(JSON.stringify({
                type: 'message',
                agentId: 'jarvis',
                text: 'test message for ack',
                conversationId,
              }));
              return;
            }

            // Check for message_ack
            if (data.type === 'message_ack') {
              clearTimeout(timeout);
              ws.close();
              resolve({
                gotAck: true,
                ackRole: data.message?.role ?? null,
                ackConvId: data.conversationId ?? null,
              });
              return;
            }
          } catch {
            // Ignore parse errors
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve({ gotAck: false, ackRole: null, ackConvId: null });
        };
      });
    }, { baseUrl: server.baseUrl, conversationId });

    expect(result.gotAck).toBe(true);
    expect(result.ackRole).toBe('user');
    expect(result.ackConvId).toBe(conversationId);
  });

  test('/ws receives typing indicator after message_ack', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin', { waitUntil: 'domcontentloaded' });

    // Create a conversation via API
    const convRes = await page.request.post(server.baseUrl + '/api/chat/conversations', {
      data: { agentId: 'jarvis' },
    });
    const convData = await convRes.json();
    const conversationId = convData.conversation?.id;
    expect(conversationId).toBeTruthy();

    const result = await page.evaluate(async ({ baseUrl, conversationId }) => {
      return new Promise<{ gotAck: boolean; gotTyping: boolean; typingAfterAck: boolean; typingAgentId: string | null }>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ gotAck, gotTyping, typingAfterAck: gotTyping && gotAck, typingAgentId: null });
        }, 5000);

        const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws');
        let sentMessage = false;
        let gotAck = false;
        let gotTyping = false;
        let typingAgentId: string | null = null;

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'connected' && !sentMessage) {
              sentMessage = true;
              ws.send(JSON.stringify({
                type: 'message',
                agentId: 'jarvis',
                text: 'test message for typing',
                conversationId,
              }));
              return;
            }

            if (data.type === 'message_ack') {
              gotAck = true;
            }

            if (data.type === 'typing') {
              gotTyping = true;
              typingAgentId = data.agentId ?? null;
              clearTimeout(timeout);
              ws.close();
              resolve({
                gotAck,
                gotTyping: true,
                typingAfterAck: gotAck,
                typingAgentId,
              });
              return;
            }
          } catch {
            // Ignore parse errors
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve({ gotAck: false, gotTyping: false, typingAfterAck: false, typingAgentId: null });
        };
      });
    }, { baseUrl: server.baseUrl, conversationId });

    expect(result.gotAck).toBe(true);
    expect(result.gotTyping).toBe(true);
    expect(result.typingAfterAck).toBe(true);
    expect(result.typingAgentId).toBe('jarvis');
  });

  test('/ws returns error for unknown agent', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin', { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async (baseUrl) => {
      return new Promise<{ gotError: boolean; errorText: string | null }>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ gotError: false, errorText: null });
        }, 5000);

        const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws');
        let sentMessage = false;

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'connected' && !sentMessage) {
              sentMessage = true;
              ws.send(JSON.stringify({
                type: 'message',
                agentId: 'nonexistent',
                text: 'hello from nowhere',
                conversationId: 'conv_fake',
              }));
              return;
            }

            if (data.type === 'error') {
              clearTimeout(timeout);
              ws.close();
              resolve({
                gotError: true,
                errorText: data.text ?? null,
              });
              return;
            }
          } catch {
            // Ignore parse errors
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve({ gotError: false, errorText: null });
        };
      });
    }, server.baseUrl);

    expect(result.gotError).toBe(true);
    expect(result.errorText).toBeTruthy();
    expect(result.errorText).toContain('nonexistent');
  });

  test('/ws handles malformed JSON gracefully', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin', { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async (baseUrl) => {
      return new Promise<{ connected: boolean; stillOpen: boolean; gotError: boolean }>((resolve) => {
        const timeout = setTimeout(() => {
          const stillOpen = ws.readyState === WebSocket.OPEN;
          ws.close();
          resolve({ connected: true, stillOpen, gotError: false });
        }, 3000);

        const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws');
        let connected = false;
        let gotError = false;

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'connected' && !connected) {
              connected = true;
              // Send malformed (non-JSON) text
              ws.send('this is not valid json {{{');
              return;
            }

            if (data.type === 'error') {
              gotError = true;
              // Connection should still be open after an error frame
              clearTimeout(timeout);
              const stillOpen = ws.readyState === WebSocket.OPEN;
              ws.close();
              resolve({ connected: true, stillOpen, gotError: true });
              return;
            }
          } catch {
            // Ignore
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve({ connected: false, stillOpen: false, gotError: false });
        };
      });
    }, server.baseUrl);

    expect(result.connected).toBe(true);
    // The server should either send an error frame and keep the connection open,
    // or at minimum not crash (connection remains open during the timeout window)
    expect(result.stillOpen).toBe(true);
  });

  test('/ws generates unique client IDs', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin', { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async (baseUrl) => {
      const getClientId = (): Promise<string | null> => {
        return new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(null), 5000);
          const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws');

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'connected' && data.clientId) {
                clearTimeout(timeout);
                ws.close();
                resolve(data.clientId);
              }
            } catch {
              clearTimeout(timeout);
              ws.close();
              resolve(null);
            }
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            resolve(null);
          };
        });
      };

      const clientId1 = await getClientId();
      const clientId2 = await getClientId();

      return {
        clientId1,
        clientId2,
        bothPresent: clientId1 !== null && clientId2 !== null,
        unique: clientId1 !== clientId2,
      };
    }, server.baseUrl);

    expect(result.bothPresent).toBe(true);
    expect(result.unique).toBe(true);
    expect(result.clientId1).not.toBe(result.clientId2);
  });

  test('/ws connection survives after send', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin', { waitUntil: 'domcontentloaded' });

    // Create a conversation via API
    const convRes = await page.request.post(server.baseUrl + '/api/chat/conversations', {
      data: { agentId: 'jarvis' },
    });
    const convData = await convRes.json();
    const conversationId = convData.conversation?.id;
    expect(conversationId).toBeTruthy();

    const result = await page.evaluate(async ({ baseUrl, conversationId }) => {
      return new Promise<{ gotAck: boolean; socketOpenAfterAck: boolean }>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ gotAck: false, socketOpenAfterAck: false });
        }, 5000);

        const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws');
        let sentMessage = false;

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'connected' && !sentMessage) {
              sentMessage = true;
              ws.send(JSON.stringify({
                type: 'message',
                agentId: 'jarvis',
                text: 'test message for persistence',
                conversationId,
              }));
              return;
            }

            if (data.type === 'message_ack') {
              // Check readyState immediately after receiving ack
              const socketOpenAfterAck = ws.readyState === WebSocket.OPEN;
              clearTimeout(timeout);
              ws.close();
              resolve({
                gotAck: true,
                socketOpenAfterAck,
              });
              return;
            }
          } catch {
            // Ignore parse errors
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve({ gotAck: false, socketOpenAfterAck: false });
        };
      });
    }, { baseUrl: server.baseUrl, conversationId });

    expect(result.gotAck).toBe(true);
    expect(result.socketOpenAfterAck).toBe(true);
  });
});
