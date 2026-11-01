import { expect, test } from "@playwright/test";

// The site is invite-only: every page except sign-in sends a signed-out visitor to sign in.
test("signed-out visitors are sent to sign in from every member page", async ({ page }) => {
  for (const path of ["/", "/marketplace", "/sellers", "/how-it-works", "/cart"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/account\/login/);
  }
});

test("sign-in page shows the form", async ({ page }) => {
  await page.goto("/account/login");
  await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
});

test("the admin area and the Live Tracker send signed-out visitors to sign in", async ({ page }) => {
  for (const path of ["/admin", "/tracker"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/account\/login/);
  }
});

test("a wrong password shows an error and stays on the sign-in page", async ({ page }) => {
  await page.goto("/account/login");
  await page.locator('input[name="email"]').fill("nobody-e2e@example.invalid");
  await page.locator('input[name="password"]').fill("not-a-real-password");
  await page.locator('button[type="submit"]').first().click();
  await expect(page.getByText(/incorrect email or password|too many attempts/i)).toBeVisible();
  await expect(page).toHaveURL(/\/account\/login/);
});

test("robots.txt keeps crawlers out and is reachable without signing in", async ({ request }) => {
  const robots = await request.get("/robots.txt", { maxRedirects: 0 });
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Disallow: /");
});
