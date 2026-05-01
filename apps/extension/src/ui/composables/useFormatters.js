export function useFormatters() {
  function formatTime(timestamp) {
    if (!timestamp) return 'Just now';
    return new Date(timestamp).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeHtmlAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function formatRichText(content) {
    const escaped = escapeHtml(content);

    // Markdown links: [label](any-url) — supports https, http, file, relative, etc.
    const withMarkdownLinks = escaped.replace(
      /\[([^\]]+?)\]\(([^)\s]+)\)/g,
      (_, label, url) => {
        const safeUrl = escapeHtmlAttribute(url);
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
    );

    // Bare URLs (http/https only, to avoid false positives)
    const withBareLinks = withMarkdownLinks.replace(
      /(?<!href="|">)(https?:\/\/[^\s<]+?)([).,!?;:]?)(?=\s|<|$)/g,
      (_, url, trailing) => {
        const safeUrl = escapeHtmlAttribute(url);
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing || ''}`;
      }
    );

    return withBareLinks
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function formatColumnLabel(column) {
    return String(column || '')
      .split('_')
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function getMessageList(content) {
    if (Array.isArray(content) && content.every(item => typeof item === 'string')) {
      return content;
    }

    if (typeof content !== 'string') return [];

    const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    // Try JSON array of strings
    try {
      const parsed = JSON.parse(normalized);
      if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
        return parsed;
      }
    } catch {
      const compact = normalized.replace(/\r/g, '');
      if (compact.startsWith('[') && compact.endsWith(']')) {
        const matches = [...compact.matchAll(/"([^"\n]+)"/g)].map(match => match[1]);
        if (matches.length > 0) return matches;
      }
    }

    const lines = normalized.replace(/\r/g, '').split('\n');
    const items = [];
    for (const line of lines) {
      // Standard bullet points: -, *, •
      const bulletMatch = line.match(/^\s*(?:[-*•])\s+(.+?)\s*$/);
      if (bulletMatch?.[1]) {
        items.push(bulletMatch[1]);
        continue;
      }
      // Numbered lists: 1. or 1)
      const numberedMatch = line.match(/^\s*\d+[.)]\s+(.+?)\s*$/);
      if (numberedMatch?.[1]) {
        items.push(numberedMatch[1]);
        continue;
      }
    }
    if (items.length > 0) return items;

    // Heuristic: multi-line content where each line has similar delimiter pattern
    // (e.g., "Name - Category - $Price - Stock: N - [Link](url)")
    const nonEmptyLines = lines.map(l => l.trim()).filter(Boolean);
    if (nonEmptyLines.length >= 2) {
      const delimiterPattern = /\s+-\s+/;
      const linesWithDelimiters = nonEmptyLines.filter(l => delimiterPattern.test(l));
      // If most lines follow the pattern, treat as a list
      if (linesWithDelimiters.length >= Math.ceil(nonEmptyLines.length * 0.6)) {
        return nonEmptyLines;
      }
    }

    return [];
  }

  function getStructuredTable(content) {
    const parsed = parseStructuredContent(content);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (!parsed.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
      return null;
    }

    const columns = [...new Set(parsed.flatMap(row => Object.keys(row)))];
    if (columns.length === 0) return null;

    const rows = parsed.map(row => {
      const normalizedRow = {};
      columns.forEach(column => {
        const value = row[column];
        normalizedRow[column] =
          value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      });
      return normalizedRow;
    });

    return { columns, rows };
  }

  function parseStructuredContent(content) {
    if (Array.isArray(content)) return content;
    if (typeof content !== 'string') return null;

    const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    try {
      return JSON.parse(normalized);
    } catch {
      return null;
    }
  }

  return {
    formatTime,
    escapeHtml,
    formatRichText,
    formatColumnLabel,
    getMessageList,
    getStructuredTable,
  };
}