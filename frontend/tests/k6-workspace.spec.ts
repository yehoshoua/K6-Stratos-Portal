import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("role", "editor");
    localStorage.setItem("username", "qa-user");
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/k8s/active-tests") return route.fulfill({ json: { active_count: 1, first_active: "checkout-load" } });
    if (url.pathname === "/api/k8s/operator-status") return route.fulfill({ json: { status: "ready", accessible_count: 1, deployed_count: 1, total_count: 1 } });
    if (url.pathname === "/api/v1/fleet/summary") return route.fulfill({ json: { total_accounts: 1, total_clusters: 1, online_clusters: 1, active_schedules: 1, active_test_runs: 1, open_guardian_blocks: 0, clusters: [] } });
    if (url.pathname === "/api/auth/me")
      return route.fulfill({ json: { username: "qa-user", role: "editor" } });
    if (url.pathname === "/api/k8s/clusters")
      return route.fulfill({
        json: [
          {
            id: "cluster-a",
            name: "Cluster A",
            api_server_url: "",
            auth_type: "token",
            created_at: "",
            k6_operator_installed: true,
          },
        ],
      });
    if (url.pathname.endsWith("/namespaces"))
      return route.fulfill({ json: ["qa"] });
    if (url.pathname.endsWith("/crds"))
      return route.fulfill({
        json: [
          {
            apiVersion: "k6.io/v1alpha1",
            kind: "TestRun",
            metadata: {
              name: "checkout-load",
              namespace: "qa",
              creationTimestamp: "2026-07-17T08:00:00Z",
            },
            spec: {
              parallelism: 2,
              script: {
                configMap: { name: "checkout-script", file: "script.js" },
              },
            },
            status: { stage: "running" },
          },
        ],
      });
    if (url.pathname.endsWith("/batch-workloads"))
      return route.fulfill({
        json: [
          {
            apiVersion: "batch/v1",
            kind: "Job",
            metadata: {
              name: "catalog-job",
              namespace: "qa",
              creationTimestamp: "2026-07-17T07:00:00Z",
            },
            spec: { script: { configMap: { name: "catalog-script" } } },
            status: { stage: "complete" },
          },
          {
            apiVersion: "batch/v1",
            kind: "CronJob",
            metadata: {
              name: "nightly-checkout",
              namespace: "qa",
              creationTimestamp: "2026-07-16T07:00:00Z",
            },
            spec: {
              schedule: "0 9 * * *",
              script: { configMap: { name: "checkout-script" } },
            },
            status: { stage: "", active: true },
          },
        ],
      });
    if (url.pathname === "/api/settings/templates")
      return route.fulfill({
        json: [
          {
            id: "template-a",
            name: "Checkout template",
            template_type: "testrun",
            parallelism: 2,
            script_name: "checkout-script",
            script_file: "script.js",
            cpu_limit: "500m",
            mem_limit: "512Mi",
            script_content: "export default function () {}",
            created_at: "",
          },
        ],
      });
    if (url.pathname === "/api/settings/defaults")
      return route.fulfill({
        json: {
          output_args: "",
          use_output: "false",
          use_image: "false",
          image_url: "",
          env_vars: [],
        },
      });
    if (url.pathname.endsWith("/configmaps"))
      return route.fulfill({
        json: [
          {
            name: "checkout-script",
            namespace: "qa",
            data: { "script.js": "export default function () {}" },
          },
        ],
      });
    return route.fulfill({ json: [] });
  });
});

test("shows TestRun and Job together, then the CronJob schedule", async ({
  page,
}) => {
  await page.goto("/tests");
  await expect(page.getByRole("heading", { name: "K6 Tests" })).toBeVisible();
  await expect(page.getByText("checkout-load")).toBeVisible();
  await expect(page.getByText("catalog-job")).toBeVisible();

  await page.getByRole("button", { name: "Schedules" }).click();
  await expect(page.getByText("nightly-checkout")).toBeVisible();
  await expect(page.getByText("Every day at 09:00")).toBeVisible();
});

test("keeps legacy schedules links compatible", async ({ page }) => {
  await page.goto("/schedules");
  await expect(page).toHaveURL(/\/tests\?tab=schedules/);
  await expect(page.getByText("nightly-checkout")).toBeVisible();
});

test("keeps Continue visible and closes the wizard with Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto("/tests");
  await page.getByRole("button", { name: "New test" }).click();

  const dialog = page.getByRole("dialog", { name: "New test" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Checkout template/ }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByLabel("Namespace")).toHaveValue("qa");
  await dialog.getByRole("button", { name: "Continue" }).click();

  await expect(
    dialog.getByRole("button", { name: "Continue" }),
  ).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("shows schedule actions above the table and uses the portal confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto("/tests?tab=schedules");
  await expect(page.getByText("nightly-checkout")).toBeVisible();

  await page.getByRole("button", { name: "More actions" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Modifier" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(menu).toBeInViewport();

  await menu.getByRole("button", { name: "Delete" }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete this resource?" }),
  ).toBeVisible();
});

test("configures a guided HTTP test, previews its script and restores a safe draft", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.goto("/tests");
  await page.getByRole("button", { name: "New test" }).click();
  const dialog = page.getByRole("dialog", { name: "New test" });
  await dialog.getByRole("button", { name: /Start an HTTP test/ }).click();
  await expect(dialog.getByLabel("Namespace")).toHaveValue("qa");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByLabel("Target URL").fill("https://example.test/api?token=not-persisted");
  await dialog.getByLabel("Virtual users", { exact: true }).fill("25");
  await dialog.getByLabel("HTTP method").selectOption("POST");
  await dialog.getByLabel("Request body").fill('{"message":"not-persisted"}');
  await expect(dialog.locator("pre")).toContainText('"vus": 25');
  await expect(dialog.locator("pre")).toContainText("p(95)<500");
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await page.screenshot({ path: "/tmp/k6-guided-wizard.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New test" }).click();
  await dialog.getByRole("button", { name: "Restore draft" }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByLabel("Target URL")).toHaveValue("https://example.test/api");
  await expect(dialog.getByLabel("Request body")).toHaveValue("");
  await expect(dialog.getByLabel("Virtual users", { exact: true })).toHaveValue("25");
});

for (const theme of ["light", "dark"]) {
  test(`combines chaos with HTTP and keeps controls readable in ${theme} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.goto("/tests");
    await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
    await page.getByRole("button", { name: "New test" }).click();
    const dialog = page.getByRole("dialog", { name: "New test" });
    await dialog.getByRole("button", { name: /Combined tests/ }).click();
    await expect(dialog.getByLabel("Namespace")).toHaveValue("qa");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "HTTP + chaos preset" }).click();
    for (const name of ["HTTP", "pod_kill", "network_latency"]) await expect(dialog.getByRole("checkbox", { name, exact: true })).toBeChecked();
    await dialog.getByLabel("Target URL").fill("https://example.test/health");
    await dialog.getByLabel("Pod label value").fill("checkout");
    await expect(dialog.locator("pre")).toContainText('"network_latency":');
    await expect(dialog.locator("pre")).toContainText("injectHTTPFaults");
    const contrast = await dialog.getByLabel("Target URL").evaluate(el => {
      const style = getComputedStyle(el);
      const luminance = (color: string) => {
        const [r,g,b] = color.match(/[\d.]+/g)!.slice(0,3).map(v => Number(v)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
        return r*.2126+g*.7152+b*.0722;
      };
      const a=luminance(style.color), b=luminance(style.backgroundColor);
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `/tmp/k6-combined-${theme}.png`, fullPage: true });
    await dialog.getByRole("checkbox", { name: "network_latency", exact: true }).uncheck();
    await expect(dialog.locator("pre")).not.toContainText("injectHTTPFaults");
    await dialog.getByRole("checkbox", { name: "network_latency", exact: true }).check();
    await page.setViewportSize({ width: 900, height: 600 });
    await expect(dialog.getByRole("button", { name: "Continue" })).toBeInViewport();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText(/Chaos uses one runner/)).toBeVisible();
  });
}


for (const palette of ["royal-vibrant", "golden-harvest", "cyber-neon", "gradient-blues"]) {
  for (const theme of ["light", "dark"]) {
    test(`contrast audit ${palette} ${theme}`, async ({page}) => {
      const { textContrastFailures, controlContrast } = await import("./helpers/contrast");
      const { writeFileSync } = await import("node:fs");
      const results: Record<string, unknown> = {};
      const pageErrors: string[] = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      await page.route("**/api/influx/runs", route => route.fulfill({ json: [{ test_run_id: "contrast-run", cluster: "cluster-a", namespace: "qa", start_time: "2026-10-12T10:00:00Z", duration_seconds: 60, max_vus: 10, avg_req_duration_ms: 120 }] }));
      await page.route("**/api/influx/runs/*/metrics?*", route => route.fulfill({ json: [{ timestamp: "2026-10-12T10:00:00Z", metric: "http_req_duration", value: 100 }, { timestamp: "2026-10-12T10:00:05Z", metric: "http_req_duration", value: 140 }] }));
      await page.addInitScript(({theme,palette}) => { localStorage.setItem("pref-theme", theme); localStorage.setItem("pref-palette", palette); localStorage.setItem("k6-advanced-mode", "true"); }, {theme,palette});
      for (const path of ["/tests","/tests?tab=schedules","/tests?tab=scripts","/clusters","/metrics","/settings","/","/login"]) {
        await page.goto(path);
        await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
        await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
        await expect(page.locator("html")).toHaveAttribute("data-color-scheme", theme);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        if (path === "/metrics") await expect(page.locator(".recharts-line-curve")).toBeVisible();
        if (path === "/tests") {
          const advanced = page.getByRole("button", { name: "Advanced Kubernetes" });
          await expect(advanced).toHaveAttribute("aria-pressed", "true");
          expect(await controlContrast(advanced)).toBeGreaterThanOrEqual(4.5);
          await advanced.hover();
          expect(await controlContrast(advanced)).toBeGreaterThanOrEqual(4.5);
          await advanced.focus();
          await expect(advanced).toHaveCSS("outline-style", "solid");
          await advanced.click();
          const simple = page.getByRole("button", { name: "Simple mode" });
          await expect(simple).toHaveAttribute("aria-pressed", "false");
          expect(await controlContrast(simple)).toBeGreaterThanOrEqual(4.5);
          await simple.click();
          const create = page.getByRole("button", { name: "New test" });
          expect(await controlContrast(create)).toBeGreaterThanOrEqual(4.5);
          await create.hover();
          expect(await controlContrast(create)).toBeGreaterThanOrEqual(4.5);
        }
        for (const control of await page.locator('button[class*="from-"], input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="color"]), select, textarea').all()) {
          if (await control.isVisible() && await control.isEnabled()) expect.soft(await controlContrast(control), `${path} / ${palette} / ${theme} / ${await control.getAttribute("class")}`).toBeGreaterThanOrEqual(4.5);
        }
        const failures = await textContrastFailures(page);
        results[path] = failures;
        expect.soft(failures, `${path} / ${palette} / ${theme}`).toEqual([]);
        if (path === "/tests" && palette === "royal-vibrant") await page.screenshot({ path: `/tmp/k6-contrast-fixed-${theme}.png`, fullPage: true });
      }
      expect(pageErrors).toEqual([]);
      writeFileSync(`/tmp/k6-contrast-${palette}-${theme}.json`, JSON.stringify(results,null,2));
    });
  }
}


test("preserves contrast when the system color scheme changes", async ({page}) => {
  const { controlContrast, textContrastFailures } = await import("./helpers/contrast");
  await page.addInitScript(() => { localStorage.setItem("pref-theme", "system"); localStorage.setItem("pref-palette", "golden-harvest"); localStorage.setItem("k6-advanced-mode", "true"); });
  await page.emulateMedia({colorScheme:"dark"});
  await page.goto("/tests");
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  const advanced = page.getByRole("button", {name:"Advanced Kubernetes"});
  expect(await controlContrast(advanced)).toBeGreaterThanOrEqual(4.5);
  await page.emulateMedia({colorScheme:"light"});
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light");
  expect(await controlContrast(advanced)).toBeGreaterThanOrEqual(4.5);
  await page.getByRole("button", {name:"New test"}).click();
  expect(await textContrastFailures(page)).toEqual([]);
});
