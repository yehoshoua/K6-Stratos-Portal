import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("role", "editor");
    localStorage.setItem("username", "qa-user");
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
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
