import { expect, test } from "@playwright/test";

test("keeps the configuration editor visible", async ({ page }) => {
  await page.goto("/");

  const editor = page.locator(".code-editor");
  await expect(editor).toBeVisible();
  await expect.poll(async () => editor.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(100);
});

test("allows the route result to collapse", async ({ page }) => {
  await page.goto("/");

  const routeResult = page.locator("details.simulation-outcome");
  await expect(routeResult).toHaveAttribute("open", "");

  await routeResult.locator("summary").click();

  await expect(routeResult).not.toHaveAttribute("open", "");
});
