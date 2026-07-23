import { describe, expect, it } from 'vitest';
import { STACK_TEMPLATES } from '../../src/data/stackTemplates';

describe('STACK_TEMPLATES', () => {
  it('is non-empty', () => {
    expect(STACK_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('has unique, URL-safe ids', () => {
    const ids = STACK_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('gives every template a name, description, category, and compose body', () => {
    for (const template of STACK_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.category.length).toBeGreaterThan(0);
      expect(template.compose).toContain('services:');
    }
  });

  it('gives every service a restart policy', () => {
    for (const template of STACK_TEMPLATES) {
      const serviceBlocks = template.compose.split(/\n(?=  \w)/).filter((b) => b.includes('image:'));
      for (const block of serviceBlocks) {
        expect(block).toContain('restart:');
      }
    }
  });
});
