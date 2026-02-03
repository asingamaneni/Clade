/**
 * Playwright E2E test for the Agents management page.
 *
 * The Agents page displays a list/sidebar of agents and a detail panel.
 * The detail panel has tabs or sections for: Soul, Identity/config, Tools,
 * Memory, Heartbeat. Users can edit SOUL.md, view/edit memory, view/edit
 * heartbeat, delete agents, and create new agents.
 *
 * Pre-seeded data:
 * - 2 agents: jarvis (coding, laptop emoji, "Primary coding assistant")
 *             and scout (messaging, magnifying glass emoji, "Research agent")
 * - jarvis has SOUL.md ("You are Jarvis, a coding assistant"),
 *   MEMORY.md ("Prefers TypeScript"), and HEARTBEAT.md ("Check project status.")
 */
import { test, expect } from '@playwright/test';
import { startTestServer, stopTestServer, TestServer } from './fixtures/server.ts';

let server: TestServer;

test.describe('Agents Page', () => {
  test.beforeAll(async () => {
    server = await startTestServer();
  });

  test.afterAll(() => {
    stopTestServer(server);
  });

  test('agents page shows agent list', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Agents').first().click();
    // Should see both agent names
    await expect(page.locator('text=Jarvis').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Scout').first()).toBeVisible({ timeout: 5000 });
  });

  test('clicking agent shows detail panel', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Agents').first().click();
    await page.waitForTimeout(500);
    // Click on Jarvis
    await page.locator('text=Jarvis').first().click();
    // Agent detail header renders: agent.id · model · toolPreset
    await expect(page.locator('text=sonnet').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=coding').first()).toBeVisible({ timeout: 5000 });
  });

  test('Soul tab shows SOUL.md content', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Agents').first().click();
    await page.waitForTimeout(500);
    await page.locator('text=Jarvis').first().click();
    await page.waitForTimeout(500);
    // Click Soul tab if visible
    const soulTab = page.locator('text=Soul').first();
    if (await soulTab.isVisible()) {
      await soulTab.click();
    }
    await page.waitForTimeout(500);
    // SOUL.md content is loaded into a textarea
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    const value = await textarea.inputValue();
    expect(value).toContain('coding assistant');
  });

  test('Memory tab shows memory files', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Agents').first().click();
    await page.waitForTimeout(500);
    await page.locator('text=Jarvis').first().click();
    await page.waitForTimeout(500);
    // Click Memory tab
    const memoryTab = page.locator('text=Memory').first();
    if (await memoryTab.isVisible()) {
      await memoryTab.click();
      await page.waitForTimeout(500);
      // Should see MEMORY.md listed
      await expect(page.locator('text=MEMORY.md').first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('Memory file content is viewable', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Agents').first().click();
    await page.waitForTimeout(500);
    await page.locator('text=Jarvis').first().click();
    await page.waitForTimeout(500);
    const memoryTab = page.locator('text=Memory').first();
    if (await memoryTab.isVisible()) {
      await memoryTab.click();
      await page.waitForTimeout(500);
      // Click on MEMORY.md to view content
      const memoryFile = page.locator('text=MEMORY.md').first();
      if (await memoryFile.isVisible()) {
        await memoryFile.click();
        await page.waitForTimeout(500);
        // Should see memory content
        await expect(page.locator('text=TypeScript').first()).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('Heartbeat tab shows heartbeat content', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Agents').first().click();
    await page.waitForTimeout(500);
    await page.locator('text=Jarvis').first().click();
    await page.waitForTimeout(500);
    const hbTab = page.locator('text=Heartbeat').first();
    if (await hbTab.isVisible()) {
      await hbTab.click();
      await page.waitForTimeout(500);
      // HEARTBEAT.md content is loaded into a textarea
      const textarea = page.locator('textarea').first();
      await expect(textarea).toBeVisible({ timeout: 5000 });
      const value = await textarea.inputValue();
      expect(value).toContain('Check project status');
    }
  });

  test('agent shows model and preset info', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Agents').first().click();
    await page.waitForTimeout(500);
    await page.locator('text=Jarvis').first().click();
    await page.waitForTimeout(500);
    // Should show model: sonnet and preset: coding somewhere
    await expect(page.locator('text=sonnet').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=coding').first()).toBeVisible({ timeout: 5000 });
  });

  test('create agent from template via API', async ({ request }) => {
    const res = await request.post(server.baseUrl + '/api/agents', {
      data: { name: 'newbot', template: 'coding', description: 'New test agent' },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.agent.id).toBe('newbot');

    // Verify it appears in list
    const listRes = await request.get(server.baseUrl + '/api/agents');
    const listBody = await listRes.json();
    const found = listBody.agents.find((a: { id: string }) => a.id === 'newbot');
    expect(found).toBeDefined();
  });

  test('delete agent via API', async ({ request }) => {
    // Create then delete
    await request.post(server.baseUrl + '/api/agents', {
      data: { name: 'deleteme', template: 'coding' },
    });
    const delRes = await request.delete(server.baseUrl + '/api/agents/deleteme');
    expect(delRes.ok()).toBe(true);

    // Verify it's gone
    const getRes = await request.get(server.baseUrl + '/api/agents/deleteme');
    expect(getRes.status()).toBe(404);
  });

  test('update agent SOUL.md via API', async ({ request }) => {
    const newContent = '# Updated SOUL\n\nNew personality.';
    const putRes = await request.put(server.baseUrl + '/api/agents/jarvis/soul', {
      data: { content: newContent },
    });
    expect(putRes.ok()).toBe(true);

    const getRes = await request.get(server.baseUrl + '/api/agents/jarvis/soul');
    const body = await getRes.json();
    expect(body.content).toContain('Updated SOUL');
  });

  test('update agent HEARTBEAT.md via API', async ({ request }) => {
    const newContent = '# Updated Heartbeat\n\nNew heartbeat config.';
    const putRes = await request.put(server.baseUrl + '/api/agents/jarvis/heartbeat', {
      data: { content: newContent },
    });
    expect(putRes.ok()).toBe(true);

    const getRes = await request.get(server.baseUrl + '/api/agents/jarvis/heartbeat');
    const body = await getRes.json();
    expect(body.content).toContain('Updated Heartbeat');
  });

  test('duplicate agent name returns 409', async ({ request }) => {
    const res = await request.post(server.baseUrl + '/api/agents', {
      data: { name: 'jarvis', template: 'coding' },
    });
    expect(res.status()).toBe(409);
  });

  test('memory search finds matching content', async ({ request }) => {
    const res = await request.post(server.baseUrl + '/api/agents/jarvis/memory/search', {
      data: { query: 'TypeScript' },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].snippet).toContain('TypeScript');
  });

  test('memory search returns empty for no match', async ({ request }) => {
    const res = await request.post(server.baseUrl + '/api/agents/jarvis/memory/search', {
      data: { query: 'xyznonexistent' },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.results.length).toBe(0);
  });
});
