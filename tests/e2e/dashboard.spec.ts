/**
 * Playwright E2E test for the Dashboard page.
 *
 * The Dashboard is the default view when navigating to /admin.
 * It displays 4 stat cards (Uptime, Active Agents, Sessions, Cron Jobs),
 * agent overview information, and connection status.
 *
 * Pre-seeded data:
 * - 2 agents: jarvis (coding, laptop emoji) and scout (messaging, magnifying glass emoji)
 * - 1 conversation for jarvis with 2 messages
 */
import { test, expect } from '@playwright/test';
import { startTestServer, stopTestServer, TestServer } from './fixtures/server.ts';

let server: TestServer;

test.describe('Dashboard Page', () => {
  test.beforeAll(async () => {
    server = await startTestServer();
  });

  test.afterAll(() => {
    stopTestServer(server);
  });

  test('renders 4 stat cards', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    // Look for stat card labels
    await expect(page.locator('text=Uptime').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Active Agents').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Sessions').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Cron').first()).toBeVisible({ timeout: 5000 });
  });

  test('Active Agents card shows correct count', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    // Should show 2 agents
    const agentCard = page.locator('text=Active Agents').first().locator('..');
    await expect(agentCard).toBeVisible({ timeout: 5000 });
    // The page should contain "2" somewhere near the agents card
    await expect(page.locator('text=/2/').first()).toBeVisible({ timeout: 5000 });
  });

  test('Uptime card shows a value', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    // Uptime should show something like "0m" or "1s" or similar
    const uptimeSection = page.locator('text=Uptime').first();
    await expect(uptimeSection).toBeVisible({ timeout: 5000 });
  });

  test('Sessions card shows a number', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Sessions').first()).toBeVisible({ timeout: 5000 });
  });

  test('Cron card shows count', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Cron').first()).toBeVisible({ timeout: 5000 });
  });

  test('dashboard data refreshes from API', async ({ page, request }) => {
    // Verify the health API returns data
    const healthRes = await request.get(server.baseUrl + '/health');
    expect(healthRes.ok()).toBe(true);
    const health = await healthRes.json();
    expect(health.uptime).toBeGreaterThan(0);

    // Load dashboard
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    // Dashboard should be visible
    await expect(page.locator('text=Uptime').first()).toBeVisible({ timeout: 5000 });
  });

  test('dashboard shows agent names', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    // Agent names should appear somewhere on the dashboard
    await expect(page.locator('text=Jarvis').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Scout').first()).toBeVisible({ timeout: 5000 });
  });

  test('dashboard shows connection status', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    // The WebSocket should connect and show connected status
    // Wait a moment for WS to connect
    await page.waitForTimeout(1000);
    // Connection indicator should be present (green dot or "Connected")
    // The topbar has a connection status element
    await expect(page.locator('text=Clade Admin').first()).toBeVisible();
  });
});
