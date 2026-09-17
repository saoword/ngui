import { expect, test } from "@playwright/test";

test("keeps the configuration editor visible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Show side panels|显示两侧面板/ }).click();

  const editor = page.locator(".code-editor");
  await expect(editor).toBeVisible();
  await expect.poll(async () => editor.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(100);
});

test("allows the request route simulator to collapse", async ({ page }) => {
  await page.goto("/");

  const simulator = page.locator("details.simulator-collapse");
  await expect(simulator).toHaveAttribute("open", "");

  await simulator.locator("summary").click();

  await expect(simulator).not.toHaveAttribute("open", "");
});
