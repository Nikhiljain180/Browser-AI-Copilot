/**
 * DOMPurify Sanitization - Prevent Prompt Injection
 * Sanitizes all extracted DOM content
 */

// Simple sanitization for extracted content (DOMPurify would be installed in real app)
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
   * Sanitize extracted HTML
   */
  static sanitizeHTML(html) {
    // In production, use DOMPurify library
    // For now, strip dangerous elements
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Remove script, style, iframe tags
    const dangerous = tempDiv.querySelectorAll('script, style, iframe, object, embed');
    dangerous.forEach(el => el.remove());

    return tempDiv.innerHTML;
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
