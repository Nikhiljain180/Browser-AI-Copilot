const ContentSanitizer = {
  sanitizeText: (text) => {
    if (!text) return '';
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(String(text), { ALLOWED_TAGS: [] });
    }
    return String(text)
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  },
  sanitizeHTML: (html) => {
    if (!html) return '';
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'div', 'span', 'a', 'ul', 'ol', 'li'],
        ALLOWED_ATTR: ['href', 'target', 'rel'],
      });
    }
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    tempDiv.querySelectorAll('script, style, iframe').forEach((el) => el.remove());
    return tempDiv.innerHTML;
  },
};
