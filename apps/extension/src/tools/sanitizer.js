/**
 * DOMPurify Sanitization - Prevent Prompt Injection
 * Sanitizes all extracted DOM content
 */

import DOMPurify from 'dompurify';

class ContentSanitizer {
  /**
   * Sanitize text content to prevent prompt injection
   */
  static sanitizeText(text) {
    if (!text) return '';
    
    return String(text)
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Sanitize extracted HTML using DOMPurify
   */
  static sanitizeHTML(html) {
    if (!html) return '';
    
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
      ALLOW_DATA_ATTR: false
    });
  }

  /**
   * Sanitize JSON extracted from page
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
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        sanitized[key] = this.sanitizeJSON(value);
      }
    }
    return sanitized;
  }
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ContentSanitizer;
}
