const { test, expect } = require('@playwright/test');

test.describe('Login', () => {
  test('shows login page when not authenticated', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('shows error on wrong password', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder(/username/i).fill('admin');
    await page.getByPlaceholder(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/invalid|incorrect|wrong|unauthorized/i)).toBeVisible();
  });

  test('admin login redirects to dashboard', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder(/username/i).fill('admin');
    await page.getByPlaceholder(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/dashboard|overview/i)).toBeVisible({ timeout: 8000 });
  });
});
