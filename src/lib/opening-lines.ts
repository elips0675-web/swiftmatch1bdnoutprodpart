export const OPENING_LINE_CATEGORIES = ['friendly', 'interests', 'humor', 'flirty', 'activity'] as const;

export type OpeningLineCategory = (typeof OPENING_LINE_CATEGORIES)[number];

const LINES_PER_CATEGORY: Record<OpeningLineCategory, number> = {
  friendly: 4,
  interests: 4,
  humor: 4,
  flirty: 4,
  activity: 4,
};

export type OpeningLineVars = {
  firstName?: string | null;
  commonInterest?: string | null;
};

export function openingLineKeys(category: OpeningLineCategory): string[] {
  return Array.from({ length: LINES_PER_CATEGORY[category] }, (_, i) => `chats.opening.${category}.${i + 1}`);
}

export function missingPlaceholders(template: string, vars: OpeningLineVars): string[] {
  const missing: string[] = [];
  if (template.includes('{{firstName}}') && !vars.firstName) missing.push('firstName');
  if (template.includes('{{commonInterest}}') && !vars.commonInterest) missing.push('commonInterest');
  return missing;
}

export function renderOpeningLine(template: string, vars: OpeningLineVars): string {
  return template
    .replace(/\{\{firstName\}\}/g, (vars.firstName ?? '').trim())
    .replace(/\{\{commonInterest\}\}/g, (vars.commonInterest ?? '').trim());
}

export function firstNameOf(displayName?: string | null): string {
  return (displayName ?? '').trim().split(/\s+/)[0] || '';
}
