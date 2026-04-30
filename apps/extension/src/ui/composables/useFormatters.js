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

    const withMarkdownLinks = escaped.replace(
      /\[([^\]]+?)\]\((https?:\/\/[^)\s]+)\)/g,
      (_, label, url) => {
        const safeUrl = escapeHtmlAttribute(url);
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
    );

    const withBareLinks = withMarkdownLinks.replace(
      /(https?:\/\/[^\s<]+?)([).,!?;:]?)(?=\s|$)/g,
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
      const bulletMatch = line.match(/^\s*(?:[-*•])\s+(.+?)\s*$/);
      if (bulletMatch?.[1]) {
        items.push(bulletMatch[1]);
        continue;
      }
      const numberedMatch = line.match(/^\s*\d+[.)]\s+(.+?)\s*$/);
      if (numberedMatch?.[1]) {
        items.push(numberedMatch[1]);
      }
    }
    if (items.length > 0) return items;

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
