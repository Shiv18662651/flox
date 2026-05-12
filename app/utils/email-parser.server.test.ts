// Unit tests for email-parser.server.ts
// Requirements: 5.2, 5.3, 5.4, 5.5

import { describe, it, expect } from 'vitest';
import { parseAndValidateEmails, isValidEmail } from './email-parser.server';

describe('isValidEmail', () => {
  it('accepts a standard email address', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  it('accepts email with subdomain', () => {
    expect(isValidEmail('user@mail.example.com')).toBe(true);
  });

  it('accepts email with plus addressing', () => {
    expect(isValidEmail('user+tag@example.com')).toBe(true);
  });

  it('accepts email with dots in local part', () => {
    expect(isValidEmail('first.last@example.com')).toBe(true);
  });

  it('rejects email without @ symbol', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  it('rejects email without domain', () => {
    expect(isValidEmail('user@')).toBe(false);
  });

  it('rejects email without TLD', () => {
    expect(isValidEmail('user@example')).toBe(false);
  });

  it('rejects email with spaces', () => {
    expect(isValidEmail('user @example.com')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });
});

describe('parseAndValidateEmails', () => {
  it('returns empty results for empty input', () => {
    const result = parseAndValidateEmails('');
    expect(result).toEqual({ valid: [], invalid: [], duplicatesRemoved: 0 });
  });

  it('returns empty results for whitespace-only input', () => {
    const result = parseAndValidateEmails('   \n  ');
    expect(result).toEqual({ valid: [], invalid: [], duplicatesRemoved: 0 });
  });

  it('parses a single valid email', () => {
    const result = parseAndValidateEmails('test@example.com');
    expect(result.valid).toEqual(['test@example.com']);
    expect(result.invalid).toEqual([]);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('splits emails by commas', () => {
    const result = parseAndValidateEmails('a@b.com, c@d.com, e@f.com');
    expect(result.valid).toEqual(['a@b.com', 'c@d.com', 'e@f.com']);
  });

  it('splits emails by semicolons', () => {
    const result = parseAndValidateEmails('a@b.com; c@d.com; e@f.com');
    expect(result.valid).toEqual(['a@b.com', 'c@d.com', 'e@f.com']);
  });

  it('splits emails by newlines', () => {
    const result = parseAndValidateEmails('a@b.com\nc@d.com\ne@f.com');
    expect(result.valid).toEqual(['a@b.com', 'c@d.com', 'e@f.com']);
  });

  it('handles mixed delimiters', () => {
    const result = parseAndValidateEmails('a@b.com, c@d.com; e@f.com\ng@h.com');
    expect(result.valid).toEqual(['a@b.com', 'c@d.com', 'e@f.com', 'g@h.com']);
  });

  it('trims whitespace from entries', () => {
    const result = parseAndValidateEmails('  a@b.com  ,  c@d.com  ');
    expect(result.valid).toEqual(['a@b.com', 'c@d.com']);
  });

  it('separates valid and invalid emails', () => {
    const result = parseAndValidateEmails('good@example.com, invalid-email, another@test.org');
    expect(result.valid).toEqual(['good@example.com', 'another@test.org']);
    expect(result.invalid).toEqual(['invalid-email']);
  });

  it('deduplicates case-insensitively', () => {
    const result = parseAndValidateEmails('Test@Example.com, test@example.com, TEST@EXAMPLE.COM');
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]).toBe('Test@Example.com'); // keeps first occurrence
    expect(result.duplicatesRemoved).toBe(2);
  });

  it('counts duplicates correctly with mixed valid/invalid', () => {
    const result = parseAndValidateEmails('a@b.com, invalid, A@B.COM, a@b.com');
    expect(result.valid).toEqual(['a@b.com']);
    expect(result.invalid).toEqual(['invalid']);
    expect(result.duplicatesRemoved).toBe(2);
  });

  it('skips empty entries from consecutive delimiters', () => {
    const result = parseAndValidateEmails('a@b.com,,, c@d.com;;;\n\n\ne@f.com');
    expect(result.valid).toEqual(['a@b.com', 'c@d.com', 'e@f.com']);
    expect(result.invalid).toEqual([]);
  });
});
