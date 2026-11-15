// Shared palette roles: decorative colors remain unchanged; readable text and
// filled controls are derived independently for both color schemes.
type RGB = [number, number, number];
function rgb(hex: string): RGB {
  const value = /^#[0-9a-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map(c => c + c).join("")}` : hex;
  if (!/^#[0-9a-f]{6}$/i.test(value)) return [59, 130, 246];
  return [1,3,5].map(i => parseInt(value.slice(i,i+2),16)) as RGB;
}
function hex(color: RGB) { return "#" + color.map(v => Math.round(v).toString(16).padStart(2,"0")).join(""); }
function luminance(color: string) {
  const [r,g,b] = rgb(color).map(v => v/255).map(v => v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  return r*.2126+g*.7152+b*.0722;
}
export function contrastRatio(a: string, b: string) {
  const x=luminance(a),y=luminance(b);
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export function mixColor(a: string, b: string, amount: number) {
  const x=rgb(a),y=rgb(b);
  return hex(x.map((v,i)=>v+(y[i]-v)*amount) as RGB);
}
export function readableColor(seed: string, backgrounds: string[], light: boolean, minimum = 4.8) {
  const endpoint = light ? "#ffffff" : "#000000";
  for (let i=0;i<=100;i++) {
    const color=mixColor(seed,endpoint,i/100);
    if (backgrounds.every(bg => contrastRatio(color,bg)>=minimum)) return color;
  }
  return endpoint;
}
export interface PaletteContrastColors {
  primary: string; primaryHover: string; accent: string; accentHover: string;
  backgroundLight: string; backgroundDark: string;
}
export function paletteContrastVariables(palette: PaletteContrastColors): Record<string,string> {
  // Keep custom backgrounds in their selected scheme, so one foreground can be
  // readable on the page, cards and tinted badges at the same time.
  const lightBg = readableColor(palette.backgroundLight, ["#334155"], true, 7);
  const darkBg = readableColor(palette.backgroundDark, ["#cbd5e1"], false, 7);
  const result: Record<string,string> = {
    "--ui-background-light": lightBg, "--ui-background-dark": darkBg,
    "--ui-primary-fill": readableColor(palette.primaryHover, ["#ffffff"], false),
    "--ui-accent-fill": readableColor(palette.accentHover, ["#ffffff"], false),
  };
  for (const [scheme, bg, panel, raised] of [["light",lightBg,"#ffffff","#cbd5e1"],["dark",darkBg,"#0f172a","#1e293b"]]) {
    const surfaces = [bg,panel,raised,mixColor(bg,palette.primary,.2),mixColor(panel,palette.primary,.2),mixColor(bg,palette.accent,.2)];
    result[`--ui-primary-text-${scheme}`] = readableColor(palette.primary,surfaces,scheme==="dark");
    result[`--ui-accent-text-${scheme}`] = readableColor(palette.accent,surfaces,scheme==="dark");
  }
  return result;
}
