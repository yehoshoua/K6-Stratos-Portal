import type { Page } from "@playwright/test";

// Measure rendered text against composited ancestor backgrounds. Gradient text
// and gradient surfaces are reported separately by the explicit button checks.
export async function textContrastFailures(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (value: string): number[] => {
      ctx.clearRect(0,0,1,1); ctx.fillStyle = value; ctx.fillRect(0,0,1,1);
      return Array.from(ctx.getImageData(0,0,1,1).data).map((v,i)=>i===3?v/255:v);
    };
    const over = (fg: number[], bg: number[]) => [0,1,2].map(i => fg[i]*fg[3]+bg[i]*(1-fg[3])).concat(1);
    const luminance = (c: number[]) => c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
    const failures: { text: string; ratio: number; color: string; background: number[]; classes: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node=walker.nextNode())) {
      const el = node.parentElement;
      if (!el || !node.textContent?.trim() || el.closest('script,style,nextjs-portal,[aria-hidden="true"],:disabled,[data-contrast-exempt]')) continue;
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
      if (!rect.width || !rect.height || style.visibility !== "visible" || style.color === "transparent" || style.backgroundClip === "text") continue;
      const chain: CSSStyleDeclaration[] = [];
      let cursor: HTMLElement | null = el;
      while (cursor) { chain.unshift(getComputedStyle(cursor)); cursor = cursor.parentElement; }
      if (chain.some(s=>Number(s.opacity)<1 || s.backgroundImage!=="none")) continue;
      let bg=[255,255,255,1];
      for (const s of chain) bg=over(rgba(s.backgroundColor),bg);
      const color = el.closest("svg") ? style.fill : style.color;
      const fg=over(rgba(color),bg);
      const a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      const large = parseFloat(style.fontSize)>=24 || (parseFloat(style.fontSize)>=18.66 && parseFloat(style.fontWeight)>=700);
      if (ratio + .02 < (large?3:4.5)) failures.push({text:node.textContent.trim().slice(0,80),ratio:Math.round(ratio*100)/100,color:style.color,background:bg,classes:el.className});
    }
    return failures;
  });
}

export async function controlContrast(locator: import("@playwright/test").Locator) {
  return locator.evaluate(el => {
    const ctx=document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgba=(color:string) => { ctx.clearRect(0,0,1,1); ctx.fillStyle=color; ctx.fillRect(0,0,1,1); return Array.from(ctx.getImageData(0,0,1,1).data).map((v,i)=>i===3?v/255:v); };
    const over=(fg:number[],bg:number[])=>[0,1,2].map(i=>fg[i]*fg[3]+bg[i]*(1-fg[3])).concat(1);
    const luminance=(c:number[])=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const style=getComputedStyle(el), chain: Element[]=[];
    for (let cursor:Element|null=el;cursor;cursor=cursor.parentElement) chain.unshift(cursor);
    let bg=[255,255,255,1]; for (const item of chain) bg=over(rgba(getComputedStyle(item).backgroundColor),bg);
    const stops=style.backgroundImage.match(/rgba?\([^)]+\)/g);
    const backgrounds=stops?.map(rgba) || [bg];
    if (backgrounds.length===2) {
      const [a,b]=backgrounds;
      for(let i=1;i<10;i++) backgrounds.push(a.map((v,k)=>v+(b[k]-v)*i/10));
    }
    return Math.min(...backgrounds.map(background=>{
      const a=luminance(over(rgba(style.color),background)),b=luminance(background);
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    }));
  });
}
