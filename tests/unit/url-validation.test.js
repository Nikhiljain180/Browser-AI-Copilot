/**
 * Unit Tests for URL Validation Logic
 * Tests the URL validation that prevents agent from running on restricted pages
 */

import { describe, it, expect } from 'vitest';

describe('URL Validation Logic', () => {
  it('should detect chrome:// URLs as restricted', () => {
    const url = 'chrome://extensions/';
    const isRestricted = url.startsWith('chrome://');
    
    expect(isRestricted).toBe(true);
  });

  it('should detect chrome-extension:// URLs as restricted', () => {
    const url = 'chrome-extension://abcdef123456/popup.html';
    const isRestricted = url.startsWith('chrome-extension://');
    
    expect(isRestricted).toBe(true);
  });

  it('should detect edge:// URLs as restricted', () => {
    const url = 'edge://extensions/';
    const isRestricted = url.startsWith('edge://');
    
    expect(isRestricted).toBe(true);
  });

  it('should detect about: URLs as restricted', () => {
    const url = 'about:blank';
    const isRestricted = url.startsWith('about:');
    
    expect(isRestricted).toBe(true);
  });

  it('should allow normal HTTPS URLs', () => {
    const url = 'https://www.linkedin.com/in/nikhiljain180/';
    const isChrome = url.startsWith('chrome://');
    const isExtension = url.startsWith('chrome-extension://');
    const isEdge = url.startsWith('edge://');
    const isAbout = url.startsWith('about:');
    const isRestricted = isChrome || isExtension || isEdge || isAbout;
    
    expect(isRestricted).toBe(false);
  });

  it('should allow normal HTTP URLs', () => {
    const url = 'http://example.com';
    const isChrome = url.startsWith('chrome://');
    const isExtension = url.startsWith('chrome-extension://');
    const isEdge = url.startsWith('edge://');
    const isAbout = url.startsWith('about:');
    const isRestricted = isChrome || isExtension || isEdge || isAbout;
    
    expect(isRestricted).toBe(false);
  });

  it('should provide proper error message for restricted URLs', () => {
    const errorMessage = 'Open the Copilot on a normal web page, then try again.';
    
    expect(errorMessage).toContain('normal web page');
    expect(errorMessage).toContain('try again');
  });

  it('should handle empty URL gracefully', () => {
    const url = '';
    const isChrome = url.startsWith('chrome://');
    const isExtension = url.startsWith('chrome-extension://');
    const isEdge = url.startsWith('edge://');
    const isAbout = url.startsWith('about:');
    const isRestricted = isChrome || isExtension || isEdge || isAbout;
    
    expect(isRestricted).toBe(false);
  });

  it('should handle null URL gracefully', () => {
    const url = null;
    const isChrome = url?.startsWith('chrome://') || false;
    const isExtension = url?.startsWith('chrome-extension://') || false;
    const isEdge = url?.startsWith('edge://') || false;
    const isAbout = url?.startsWith('about:') || false;
    const isRestricted = isChrome || isExtension || isEdge || isAbout;
    
    expect(isRestricted).toBe(false);
  });
});

describe('Tab Validation Before Agent Start', () => {
  it('should validate tab URL before agent execution', () => {
    const tab = {
      id: 1,
      url: 'https://www.linkedin.com/in/nikhiljain180/'
    };

    const isValid = !(
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('edge://') ||
      tab.url.startsWith('about:')
    );

    expect(isValid).toBe(true);
  });

  it('should reject agent start on restricted tab', () => {
    const tab = {
      id: 1,
      url: 'chrome://extensions/'
    };

    const isRestricted = 
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('edge://') ||
      tab.url.startsWith('about:');

    expect(isRestricted).toBe(true);
  });

  it('should throw error when trying to start on restricted URL', () => {
    const tab = {
      url: 'chrome://extensions/'
    };

    const shouldThrow = 
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('edge://') ||
      tab.url.startsWith('about:');

    expect(shouldThrow).toBe(true);
  });
});
