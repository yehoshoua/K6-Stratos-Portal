import { describe, expect, it } from "vitest";
import { defaultPalettes } from "@/components/PreferencesContext";
import { contrastRatio, mixColor, paletteContrastVariables, readableColor } from "./colorContrast";

describe("palette contrast", () => {
  it("uses the WCAG luminance ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#fff", "#fff")).toBe(1);
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThan(4.5);
  });
  for (const palette of defaultPalettes) {
    it(`keeps ${palette.id} text and gradient controls readable in both themes`, () => {
      const vars = paletteContrastVariables(palette.colors);
      for (const theme of ["light","dark"]) {
        const bg = vars[`--ui-background-${theme}`];
        const panel = theme === "light" ? "#ffffff" : "#0f172a";
        for (const surface of [bg,panel,mixColor(bg,palette.colors.primary,.2),mixColor(panel,palette.colors.primary,.2)]) {
          expect(contrastRatio(vars[`--ui-primary-text-${theme}`],surface)).toBeGreaterThanOrEqual(4.8);
        }
      }
      // Check the entire gradient, not just the endpoint colors.
      for (let i=0;i<=10;i++) expect(contrastRatio("#ffffff",mixColor(vars["--ui-primary-fill"],vars["--ui-accent-fill"],i/10))).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("handles pale custom palettes and backgrounds in the wrong scheme", () => {
    const vars = paletteContrastVariables({primary:"#fff",primaryHover:"#fff",accent:"#ffffaa",accentHover:"#ffffaa",backgroundLight:"#000",backgroundDark:"#fff"});
    expect(contrastRatio(vars["--ui-primary-text-light"],vars["--ui-background-light"])).toBeGreaterThanOrEqual(4.8);
    expect(contrastRatio(vars["--ui-primary-text-dark"],vars["--ui-background-dark"])).toBeGreaterThanOrEqual(4.8);
    expect(contrastRatio(vars["--ui-primary-fill"],"#ffffff")).toBeGreaterThanOrEqual(4.8);
    expect(readableColor("invalid",["#fff"],false)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
