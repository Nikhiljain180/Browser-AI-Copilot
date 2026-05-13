import config from '../config';
import { PageContext } from '../types';

export function summarizePageContext(pageContext: PageContext | null | undefined): string {
  if (!pageContext) return 'No page context available';

  const clamp = (text: string | undefined | null, limit: number): string => {
    const normalized = String(text || '');
    if (limit <= 0) return '';
    return normalized.length <= limit ? normalized : normalized.slice(0, limit);
  };

  const maxChars = config.maxPageContextChars;
  const visibleTextBudget = Math.min(8000, Math.floor(maxChars * 0.6));
  const sectionsBudget = Math.min(6000, Math.floor(maxChars * 0.35));
  const linksBudget = Math.min(2000, Math.floor(maxChars * 0.15));

  const buttonsPreview =
    (pageContext.buttons || [])
      .map((button) => String(button?.text || '').trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((text) => `"${text}"`)
      .join(', ') || 'None';

  const linksPreviewRaw = (pageContext.links || [])
    .map((link) => {
      const text = String(link?.text || '')
        .trim()
        .replace(/\s+/g, ' ');
      const href = String(link?.href || '').trim();
      if (!href) return null;
      return text ? `${text} (${href})` : href;
    })
    .filter(Boolean)
    .slice(0, 20)
    .join('\n- ');
  const linksPreview = clamp(linksPreviewRaw, linksBudget);

  const visibleText = String(pageContext.textContent || '');
  const visibleTextLength = pageContext.textContentLength || visibleText.length;

  const sections = Array.isArray(pageContext.sections) ? pageContext.sections : [];
  const sectionsPreviewRaw = sections
    .slice(0, 10)
    .map((section) => {
      const title = String(section?.title || '').trim();
      const text = String(section?.text || '').trim();
      if (!title || !text) return null;
      return `## ${title}\n${text.substring(0, 1200)}`;
    })
    .filter(Boolean)
    .join('\n\n');
  const sectionsPreview = clamp(sectionsPreviewRaw, sectionsBudget);

  type ContextField = {
    label?: string;
    name?: string;
    placeholder?: string;
    agentId?: string;
    type?: string;
    required?: boolean;
    isFilled?: boolean;
  };
  type ContextForm = {
    title?: string;
    fields?: ContextField[];
  };

  const forms = Array.isArray(pageContext.forms) ? (pageContext.forms as ContextForm[]) : [];

  /** Matches extension listing shortlist cap shown in compact summary (not env-specific). */
  const listingShortlistMax = 10;

  const listingLines = Array.isArray(pageContext.listingCandidates)
    ? pageContext.listingCandidates
        .slice(0, listingShortlistMax)
        .map((row, i) => {
          const rec = row as {
            name?: unknown;
            title?: unknown;
            price?: unknown;
            agentId?: unknown;
          };
          const name = String(rec.name ?? rec.title ?? '').slice(0, 100);
          const price = String(rec.price ?? '');
          const aid = String(rec.agentId ?? '');
          return `  ${i + 1}. ${name || '(item)'} ${price ? `— ${price}` : ''} ${aid ? `[agent: ${aid}]` : ''}`;
        })
        .join('\n')
    : '';

  const formsPreviewRaw = forms
    .slice(0, 5)
    .map((form: ContextForm, formIndex: number) => {
      const formTitle = String(form?.title || '').trim() || `Form ${formIndex + 1}`;
      const fields = Array.isArray(form?.fields) ? form.fields : [];
      const fieldLines = fields.slice(0, 12).map((field: ContextField, fieldIndex: number) => {
        const label =
          String(
            field?.label || field?.name || field?.placeholder || `Field ${fieldIndex + 1}`,
          ).trim() || `Field ${fieldIndex + 1}`;
        const agentId = String(field?.agentId || '').trim() || 'unknown_agent_id';
        const type = String(field?.type || 'text').trim() || 'text';
        const required = field?.required ? 'required' : 'optional';
        const filled = field?.isFilled ? 'filled' : 'empty';
        return `  - ${label} (${agentId}, ${type}, ${required}, ${filled})`;
      });
      return [`- "${formTitle}":`, ...fieldLines].join('\n');
    })
    .join('\n');
  const formsPreview = clamp(formsPreviewRaw, Math.min(3000, Math.floor(maxChars * 0.2)));

  return `
Page: ${pageContext.title || pageContext.url}
URL: ${pageContext.url}

Structured listingCandidates (compact ranked shortlist, up to ${listingShortlistMax} shown):
${listingLines || 'None'}

Key Elements:
- Buttons: ${buttonsPreview}
- Forms: ${pageContext.forms?.length || 0} form(s)
- Links: ${pageContext.links?.length || 0} link(s)
- Tables: ${pageContext.tables?.length || 0} table(s)

Forms Field Inventory (up to 5 forms, 12 fields each):
${formsPreview || 'None'}

Links (up to 20):
- ${linksPreview || 'None'}

Visible Text (first ${visibleTextBudget} chars, total ${visibleTextLength} chars):
${clamp(visibleText, visibleTextBudget) || 'No text content'}

Section Snapshots:
${sectionsPreview || 'None'}
`;
}
