const { test, expect } = require('@playwright/test');

test.describe('Navigation & Routing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder(/username/i).fill('admin');
    await page.getByPlaceholder(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/.*#dashboard|.*\//);
  });

  test('URL hash updates when navigating to Call Report', async ({ page }) => {
    await page.getByRole('link', { name: /call report/i }).click();
    await expect(page).toHaveURL(/#call-report/);
    await expect(page.getByRole('heading', { name: /call report/i })).toBeVisible();
  });

  test('URL hash updates when navigating to Tickets', async ({ page }) => {
    await page.getByRole('link', { name: /tickets/i }).click();
    await expect(page).toHaveURL(/#tickets/);
    await expect(page.getByRole('heading', { name: /tickets/i })).toBeVisible();
  });

  test('URL hash updates when navigating to AI Analysis', async ({ page }) => {
    await page.getByRole('link', { name: /ai analysis/i }).click();
    await expect(page).toHaveURL(/#ai-analysis/);
    await expect(page.getByRole('heading', { name: /ai analysis/i })).toBeVisible();
  });

  test('URL hash updates when navigating to Agents', async ({ page }) => {
    await page.getByRole('link', { name: /agents/i }).click();
    await expect(page).toHaveURL(/#agents/);
    await expect(page.getByRole('heading', { name: /agents/i })).toBeVisible();
  });

  test('back button returns to previous page', async ({ page }) => {
    await page.getByRole('link', { name: /call report/i }).click();
    await page.waitForURL(/#call-report/);
    await page.getByRole('link', { name: /tickets/i }).click();
    await page.waitForURL(/#tickets/);
    await page.goBack();
    await expect(page).toHaveURL(/#call-report/);
    await expect(page.getByRole('heading', { name: /call report/i })).toBeVisible();
  });

  test('direct URL with hash loads correct page', async ({ page }) => {
    await page.goto('/#tickets');
    // Login if redirected
    if (await page.getByPlaceholder(/username/i).isVisible()) {
      await page.getByPlaceholder(/username/i).fill('admin');
      await page.getByPlaceholder(/password/i).fill('admin123');
      await page.getByRole('button', { name: /sign in/i }).click();
    }
    await expect(page.getByRole('heading', { name: /tickets/i })).toBeVisible({ timeout: 8000 });
  });
});
