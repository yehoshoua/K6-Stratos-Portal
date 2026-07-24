export interface K6Stage {
  duration: string;
  target: number;
}

export function scriptHasStages(script: string): boolean {
  return /stages:\s*\[/.test(script || '');
}

export function parseStagesFromScript(script: string): K6Stage[] {
  if (!script) return [];
  const stagesMatch = script.match(/stages:\s*\[([\s\S]*?)\]/);
  if (!stagesMatch) return [];

  const stages: K6Stage[] = [];
  const objects = stagesMatch[1].matchAll(/\{([\s\S]*?)\}/g);
  for (const object of objects) {
    const duration = object[1].match(/duration:\s*['"`]([^'"`]+)['"`]/)?.[1];
    const target = object[1].match(/target:\s*(\d+)/)?.[1];
    if (duration && target) {
      stages.push({ duration, target: Number(target) });
    }
  }
  return stages;
}

export function updateStagesInScript(script: string, stages: K6Stage[]): string {
  if (!script) return script;
  const body = stages.map((stage) => `        { duration: '${stage.duration}', target: ${stage.target} }`).join(',\n');
  const replacement = `stages: [\n${body}\n      ]`;
  if (/stages:\s*\[[\s\S]*?\]/.test(script)) {
    return script.replace(/stages:\s*\[[\s\S]*?\]/, replacement);
  }
  return script;
}

export function enableVisualStagesInScript(script: string): string {
  const defaultStages = [
    { duration: '1m', target: 20 },
    { duration: '3m', target: 20 },
    { duration: '1m', target: 0 },
  ];
  const stagesStr = defaultStages
    .map((stage) => `        { duration: '${stage.duration}', target: ${stage.target} }`)
    .join(',\n');

  const optionsMatch = script.match(/export\s+const\s+options\s*=\s*\{([\s\S]*?)\};/);
  if (optionsMatch) {
    if (optionsMatch[1].includes('stages:')) {
      return script;
    }

    let optionsBody = optionsMatch[1]
      .replace(/^\s*vus:\s*\d+,?\s*$/gm, '')
      .replace(/^\s*duration:\s*['"`][^'"`]+['"`],?\s*$/gm, '')
      .trim();

    let newOptionsContent = `  scenarios: {
    ramping: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
${stagesStr}
      ],
    },
  }`;

    const thresholdsMatch = optionsBody.match(/thresholds:\s*\{([\s\S]*?)\}/);
    if (thresholdsMatch) {
      newOptionsContent += `,\n  thresholds: {${thresholdsMatch[1]}}`;
    }

    return script.replace(/export\s+const\s+options\s*=\s*\{[\s\S]*?\};/, `export const options = {\n${newOptionsContent}\n};`);
  }

  return `export const options = {
  scenarios: {
    ramping: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
${stagesStr}
      ],
    },
  },
};

${script}`;
}
