/**
 * DOMPurify Sanitization - Prevent Prompt Injection
 * Sanitizes all extracted DOM content to prevent prompt injection attacks
 */

let DOMPurifyLib = null;

// Attempt to load DOMPurify if available
if (typeof DOMPurify !== 'undefined') {
  DOMPurifyLib = DOMPurify;
}

class ContentSanitizer {
  /**
   * Sanitize text content to prevent prompt injection
   * Uses DOMPurify when available, fallback to manual escaping
   */
  static sanitizeText(text) {
    if (!text) return '';

    const str = String(text);

    // Use DOMPurify if available (content script context)
    if (DOMPurifyLib) {
      return DOMPurifyLib.sanitize(str, { ALLOWED_TAGS: [] });
    }

    // Fallback for non-DOM contexts (service worker)
    return str
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Sanitize extracted HTML
   * Uses DOMPurify for safe HTML parsing, stripping dangerous elements
   */
  static sanitizeHTML(html) {
    if (!html) return '';

    // Use DOMPurify if available
    if (DOMPurifyLib) {
      return DOMPurifyLib.sanitize(html, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'div', 'span', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'td', 'th'],
        ALLOWED_ATTR: ['href', 'target', 'rel']
      });
    }

    // Fallback: manually strip dangerous elements
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const dangerous = tempDiv.querySelectorAll('script, style, iframe, object, embed, [onclick], [onerror], [onload]');
    dangerous.forEach(el => el.remove());
    return tempDiv.innerHTML;
  }

  /**
   * Sanitize JSON extracted from page
   * Recursively sanitizes all string values in objects/arrays
   */
  static sanitizeJSON(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return this.sanitizeText(String(obj));
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeJSON(item));
    }

    const sanitized = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];
        if (typeof value === 'string') {
          sanitized[key] = this.sanitizeText(value);
        } else {
          sanitized[key] = this.sanitizeJSON(value);
        }
      }
    }
    return sanitized;
  }

  /**
   * Initialize DOMPurify from external source (for non-DOM contexts)
   * @param {Object} purify - DOMPurify instance
   */
  static initializeDOMPurify(purify) {
    DOMPurifyLib = purify;
  }
}

// Export for use in content script and service worker
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ContentSanitizer;
}