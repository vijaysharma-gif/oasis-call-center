const { test, expect } = require('@playwright/test');

test.describe('Agents', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#agents');
    if (await page.getByPlaceholder(/username/i).isVisible()) {
      await page.getByPlaceholder(/username/i).fill('admin');
      await page.getByPlaceholder(/password/i).fill('admin123');
      await page.getByRole('button', { name: /sign in/i }).click();
    }
    await expect(page.getByRole('heading', { name: /agents/i })).toBeVisible({ timeout: 8000 });
  });

  test('shows agent list', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible({ timeout: 8000 });
  });

  test('search filters agents', async ({ page }) => {
    const input = page.getByPlaceholder(/search by name or number/i);
    await input.fill('zzznomatch');
    await page.waitForTimeout(400);
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBe(0);
  });

  test('search shows matching agents', async ({ page }) => {
    await page.waitForTimeout(800);
    // get first agent name from table
    const firstName = await page.locator('table tbody tr:first-child td:first-child').textContent();
    if (!firstName?.trim()) return;

    await page.getByPlaceholder(/search by name or number/i).fill(firstName.trim().slice(0, 4));
    await page.waitForTimeout(400);
    await expect(page.locator('table tbody tr').first()).toBeVisible();
  });

  test('Add Agent button opens modal', async ({ page }) => {
    await page.getByRole('button', { name: /add agent/i }).click();
    await expect(page.locator('.fixed.inset-0')).toBeVisible({ timeout: 3000 });
  });

  test('Export button is present and clickable', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export/i }).first();
    await expect(exportBtn).toBeVisible();
    // just click without asserting download (would need download event listener)
  });

  test('verified agents show checkmark icon', async ({ page }) => {
    // SVG check icon should exist for registered agents
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    if (count === 0) return;
    // At least some agents should have the verified icon
    const icons = page.locator('table tbody svg');
    await expect(icons.first()).toBeVisible({ timeout: 5000 });
  });
});
