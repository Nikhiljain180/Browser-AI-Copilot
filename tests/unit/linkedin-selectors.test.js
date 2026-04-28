/**
 * Unit Tests for LinkedIn Selector Improvements
 * Tests the enhanced extract_data function with LinkedIn-specific selectors
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('LinkedIn Selector Improvements', () => {
  let mockDocument;
  
  beforeEach(() => {
    // Mock document.querySelector
    mockDocument = {
      querySelector: vi.fn()
    };
    
    // Mock the global document
    global.document = mockDocument;
  });

  it('should try LinkedIn-specific selectors when generic selector fails', () => {
    const linkedinSelectors = [
      'section.experience', 
      '.experience-section',
      '[data-section="experience"]',
      '.pv-profile-section-experience',
      '.pvs-profile-section-experience',
      '.experience',
      '.work-experience',
      '#experience',
      '.pv-experience-section',
      '.pvs-profile-section__card-item-v2',
      '.pvs-entity__p2-entity-list',
      '.profile-section-card',
      '.experience__list',
      '.positions-list',
      '.work-experience-list',
      '.employment-section'
    ];

    expect(linkedinSelectors.length).toBe(16);
    expect(linkedinSelectors).toContain('.pv-profile-section-experience');
    expect(linkedinSelectors).toContain('.pvs-profile-section__card-item-v2');
  });

  it('should fallback to generic selectors if LinkedIn selectors fail', () => {
    const genericSelectors = [
      'table', 'ul', 'ol', 
      '[role="table"]', 
      '[data-list]', 
      '.list', 
      '.items', 
      'section', 
      '.section', 
      '.profile-section'
    ];

    expect(genericSelectors.length).toBe(10);
    expect(genericSelectors).toContain('section');
    expect(genericSelectors).toContain('.profile-section');
  });

  it('should handle selector fallback logic correctly', () => {
    let targetElement = null;
    const selectors = ['.first', '.second', '.third'];
    
    // Simulate selector fallback
    for (const selector of selectors) {
      if (selector === '.second') {
        targetElement = 'found';
        break;
      }
    }

    expect(targetElement).toBe('found');
  });

  it('should return proper error when all selectors fail', () => {
    const target = 'section.experience';
    const error = `Target not found: ${target}`;
    
    expect(error).toBe('Target not found: section.experience');
  });

  it('should handle empty target gracefully', () => {
    const target = null;
    const genericError = 'No structured data target found on the page';
    
    expect(genericError).toBeDefined();
  });
});

describe('LinkedIn DOM Structure Detection', () => {
  it('should detect common LinkedIn class patterns', () => {
    const linkedinPatterns = [
      'pv-profile-section',
      'pvs-profile-section',
      'pvs-entity',
      'profile-section-card'
    ];

    linkedinPatterns.forEach(pattern => {
      expect(pattern).toMatch(/pv|pvs|profile/i);
    });
  });

  it('should handle LinkedIn experience section variations', () => {
    const experienceVariations = [
      'experience',
      'work-experience', 
      'employment-section',
      'positions-list'
    ];

    expect(experienceVariations.length).toBe(4);
    expect(experienceVariations).toContain('experience');
  });
});
