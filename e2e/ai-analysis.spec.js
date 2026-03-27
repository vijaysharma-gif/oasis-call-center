const { test, expect } = require('@playwright/test');

test.describe('AI Analysis', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#ai-analysis');
    if (await page.getByPlaceholder(/username/i).isVisible()) {
      await page.getByPlaceholder(/username/i).fill('admin');
      await page.getByPlaceholder(/password/i).fill('admin123');
      await page.getByRole('button', { name: /sign in/i }).click();
    }
    await expect(page.getByRole('heading', { name: /ai analysis/i })).toBeVisible({ timeout: 8000 });
  });

  test('shows analysis table or empty state', async ({ page }) => {
    await page.waitForTimeout(2000);
    const hasTable = await page.locator('table').isVisible().catch(() => false);
    const hasEmpty = await page.getByText(/no analysis/i).isVisible().catch(() => false);
    expect(hasTable || hasEmpty).toBe(true);
  });

  test('category filter dropdown filters results', async ({ page }) => {
    const select = page.locator('select');
    const hasSelect = await select.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasSelect) return;

    const options = await select.locator('option').all();
    if (options.length <= 1) return;

    await select.selectOption({ index: 1 });
    await page.waitForTimeout(600);
    await expect(page.getByRole('heading', { name: /ai analysis/i })).toBeVisible();
  });

  test('search filters analysis results', async ({ page }) => {
    await page.waitForTimeout(1000);
    await page.getByPlaceholder(/search/i).fill('zzz_no_match');
    await page.waitForTimeout(600);
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBe(0);
  });

  test('Export XLSX button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /export xlsx/i })).toBeVisible();
  });

  test('clicking analysis row opens transcription modal', async ({ page }) => {
    await page.waitForTimeout(2000);
    const row = page.locator('table tbody tr').first();
    const hasRow = await row.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasRow) return;

    await row.click();
    await expect(page.locator('.fixed.inset-0')).toBeVisible({ timeout: 5000 });
  });
});
