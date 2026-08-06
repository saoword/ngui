import { expect, test } from "@playwright/test";

test("traces an imported request and jumps from an issue to its source", async ({ page }) => {
  await page.goto("/");

  const configuration = page.getByRole("textbox", { name: /Nginx configuration|Nginx 配置/ });
  await configuration.fill(`http {
  server {
    listen 80;
    server_name demo.example;
    location / {
      proxy_pass http://missing_pool;
    }
  }
}`);

  await page.getByRole("textbox", { name: /Host|主机/ }).fill("demo.example");
  await page.getByRole("textbox", { name: /Path|路径/ }).fill("/health");

  const result = page.getByRole("region", { name: /Route result|路由结果/ });
  await expect(result).toContainText(/demo\.example/);
  await expect(page.locator(".route-trace")).toBeVisible();

  const issue = page.locator("button.issue-item").first();
  await expect(issue).toContainText(/missing_pool/);
  await expect(issue).toBeVisible();
  await issue.click();
  await expect(configuration).toBeFocused();
  await expect.poll(() => configuration.inputValue()).toContain("missing_pool");
});
