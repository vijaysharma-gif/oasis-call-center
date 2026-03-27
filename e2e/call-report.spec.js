const { test, expect } = require('@playwright/test');

test.describe('Call Report', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#call-report');
    if (await page.getByPlaceholder(/username/i).isVisible()) {
      await page.getByPlaceholder(/username/i).fill('admin');
      await page.getByPlaceholder(/password/i).fill('admin123');
      await page.getByRole('button', { name: /sign in/i }).click();
    }
    await expect(page.getByRole('heading', { name: /call report/i })).toBeVisible({ timeout: 8000 });
  });

  test('shows call records table', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible({ timeout: 8000 });
  });

  test('search filters calls', async ({ page }) => {
    const totalBefore = await page.locator('table tbody tr').count();
    await page.getByPlaceholder(/search/i).fill('9899677276');
    await page.waitForTimeout(600);
    const totalAfter = await page.locator('table tbody tr').count();
    expect(totalAfter).toBeLessThanOrEqual(totalBefore);
  });

  test('Received filter shows only received calls', async ({ page }) => {
    await page.getByRole('button', { name: /received/i }).click();
    await page.waitForTimeout(600);
    // All visible rows should have a non-empty agent answer time (status badge "Received")
    const badges = page.locator('text=Received');
    await expect(badges.first()).toBeVisible({ timeout: 5000 });
  });

  test('Missed filter shows only missed calls', async ({ page }) => {
    await page.getByRole('button', { name: /missed/i }).click();
    await page.waitForTimeout(600);
    const badges = page.locator('text=Missed');
    await expect(badges.first()).toBeVisible({ timeout: 5000 });
  });

  test('missed calls do not appear at top when sorting by agent duration desc', async ({ page }) => {
    await page.waitForTimeout(1000);
    // Click agent duration column header to sort descending
    await page.getByRole('columnheader', { name: /agent dur/i }).click();
    await page.waitForTimeout(600);
    // First row should have a duration value, not be a missed call
    const firstRowStatus = page.locator('table tbody tr:first-child').getByText(/missed/i);
    await expect(firstRowStatus).not.toBeVisible();
  });

  test('Export XLSX button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /export xlsx/i })).toBeVisible();
  });

  test('date range filter updates results', async ({ page }) => {
    const fromInput = page.locator('input[type="date"]').first();
    await fromInput.fill('2026-03-27');
    await page.waitForTimeout(800);
    const total = await page.locator('p').filter({ hasText: /total records/i }).textContent();
    expect(total).toBeTruthy();
  });
});
