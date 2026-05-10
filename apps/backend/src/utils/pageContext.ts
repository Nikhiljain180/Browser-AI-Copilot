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

  return `
Page: ${pageContext.title || pageContext.url}
URL: ${pageContext.url}

Key Elements:
- Buttons: ${buttonsPreview}
- Forms: ${pageContext.forms?.length || 0} form(s)
- Links: ${pageContext.links?.length || 0} link(s)
- Tables: ${pageContext.tables?.length || 0} table(s)

Links (up to 20):
- ${linksPreview || 'None'}

Visible Text (first ${visibleTextBudget} chars, total ${visibleTextLength} chars):
${clamp(visibleText, visibleTextBudget) || 'No text content'}

Section Snapshots:
${sectionsPreview || 'None'}
`;
}
