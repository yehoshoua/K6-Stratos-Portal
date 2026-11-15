import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import K6TestWizard, { extractEnvVarsFromScript } from "./K6TestWizard";

const apiMock = vi.hoisted(() => ({
  getClusters: vi.fn(),
  getTemplates: vi.fn(),
  getRunDefaults: vi.fn(),
  getNamespaces: vi.fn(),
  resolveClusterImage: vi.fn(),
  createCRD: vi.fn(),
  listFiles: vi.fn(),
}));

vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("@/components/PreferencesContext", () => ({
  usePreferences: () => ({ lang: "fr", t: (key: string) => key }),
}));
vi.mock("@/components/guardian/PreflightPanel", () => ({
  default: () => null,
}));
vi.mock("@/components/K6StagesVisualEditor", () => ({
  default: () => <div>visual-stage-editor</div>,
}));

describe("K6TestWizard steps", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    apiMock.getClusters.mockResolvedValue([
      {
        id: "cluster-a",
        name: "Cluster A",
        api_server_url: "",
        auth_type: "token",
        created_at: "",
        k6_operator_installed: true,
      },
    ]);
    apiMock.getTemplates.mockResolvedValue([
      {
        id: "template-a",
        name: "Smoke test",
        template_type: "testrun",
        parallelism: 2,
        script_name: "smoke-script",
        script_file: "script.js",
        cpu_limit: "500m",
        mem_limit: "512Mi",
        script_content:
          "export const options = { stages: [{ duration: '30s', target: 5 }] };",
        created_at: "",
      },
    ]);
    apiMock.getRunDefaults.mockResolvedValue({
      output_args: "",
      use_output: false,
      use_image: false,
      image_url: "",
      env_vars: [],
    });
    apiMock.getNamespaces.mockResolvedValue(["qa"]);
    apiMock.resolveClusterImage.mockImplementation(
      async (_clusterId: string, image: string) => image,
    );
    apiMock.listFiles.mockResolvedValue([]);
  });

  it("walks through template, target, load, resources, launch and review", async () => {
    render(
      <K6TestWizard
        open
        advancedMode
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Smoke test/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

    expect(await screen.findByLabelText("Cluster")).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Namespace") as HTMLSelectElement).value,
      ).toBe("qa"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

    expect(await screen.findByText("visual-stage-editor")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByLabelText("Limite CPU")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

    expect(
      await screen.findByRole("button", { name: /Lancer maintenant/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    expect((await screen.findAllByText("Vérification")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("Cluster A / qa")).toBeTruthy();
  });

  it("does not fall back to default when no labeled namespace is returned", async () => {
    apiMock.getNamespaces.mockResolvedValueOnce([]);
    render(
      <K6TestWizard
        open
        advancedMode={false}
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Smoke test/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Namespace") as HTMLSelectElement).value,
      ).toBe(""),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Complétez les champs obligatoires",
    );
  });

  it("closes the wizard with the Escape key", async () => {
    const onClose = vi.fn();
    render(
      <K6TestWizard
        open
        advancedMode={false}
        onClose={onClose}
        onCreated={() => undefined}
      />,
    );

    await screen.findByRole("dialog", { name: "Nouveau test" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("adds selected action variables to the new test", async () => {
    render(
      <K6TestWizard
        open
        advancedMode={false}
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Smoke test/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

    fireEvent.click(await screen.findByRole("checkbox", { name: /Amazon S3/ }));
    expect(screen.getByDisplayValue("S3_PRESIGNED_URL")).toBeTruthy();
    const s3Url = screen.getByLabelText("S3_PRESIGNED_URL") as HTMLInputElement;
    fireEvent.change(s3Url, { target: { value: "https://bucket.s3.amazonaws.com/object" } });
    expect(s3Url.value).toBe("https://bucket.s3.amazonaws.com/object");
  });

  it("allows clicking stepper buttons to navigate steps", async () => {
    render(
      <K6TestWizard
        open
        advancedMode
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Smoke test/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuer" })); // Target

    // Navigate back to Template by clicking the Template stepper button
    fireEvent.click(screen.getByRole("button", { name: "Template" }));
    expect(screen.queryByLabelText("Cluster")).toBeNull();
  });

  it("dynamically sets testrun or job based on parallelism", async () => {
    render(
      <K6TestWizard
        open
        advancedMode
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Smoke test/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuer" })); // to Target
    fireEvent.click(screen.getByRole("button", { name: "Continuer" })); // to Load
    fireEvent.click(screen.getByRole("button", { name: "Continuer" })); // to Resources
    
    const parallelismInput = await screen.findByLabelText("Parallélisme") as HTMLInputElement;
    expect(parallelismInput.value).toBe("2"); // default parallelism from template-a is 2
    
    // Change parallelism to 1
    fireEvent.change(parallelismInput, { target: { value: "1" } });
    expect(parallelismInput.value).toBe("1");
    
    // Proceed to Launch and then Review step
    fireEvent.click(screen.getByRole("button", { name: "Continuer" })); // to Launch
    fireEvent.click(screen.getByRole("button", { name: "Continuer" })); // to Review
    
    // Confirm it shows Job in review step
    expect((await screen.findAllByText("Job")).length).toBeGreaterThan(0);
    
    // Click stepper to go back and verify it switches to TestRun if parallelism is changed to > 1
    fireEvent.click(screen.getByRole("button", { name: "Ressources" }));
    const pInput = await screen.findByLabelText("Parallélisme") as HTMLInputElement;
    fireEvent.change(pInput, { target: { value: "3" } });
    
    fireEvent.click(screen.getByRole("button", { name: "Vérification" }));
    expect((await screen.findAllByText("TestRun")).length).toBeGreaterThan(0);
  });
});

describe("extractEnvVarsFromScript helper", () => {
  it("extracts env variables with dot and bracket notations", () => {
    const script = `
      export default function() {
        http.get("https://" + __ENV.TARGET_HOST + "/api");
        const tok = __ENV["API_TOKEN"];
        const another = __ENV['OTHER_VAR'];
        console.log(__ENV.USER_ID);
      }
    `;
    const vars = extractEnvVarsFromScript(script);
    expect(vars).toContain("TARGET_HOST");
    expect(vars).toContain("API_TOKEN");
    expect(vars).toContain("OTHER_VAR");
    expect(vars).toContain("USER_ID");
    expect(vars.length).toBe(4);
  });
});
