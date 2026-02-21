import { describe, expect, it } from 'vitest';

import { parseTimeout } from '../timeout.js';

describe('parseTimeout', () => {
  it('parses minutes', () => {
    expect(parseTimeout('30m')).toBe(30 * 60 * 1000);
  });

  it('parses hours', () => {
    expect(parseTimeout('1h')).toBe(60 * 60 * 1000);
  });

  it('parses hours and minutes', () => {
    expect(parseTimeout('2h30m')).toBe((2 * 60 + 30) * 60 * 1000);
  });

  it('parses seconds', () => {
    expect(parseTimeout('90s')).toBe(90 * 1000);
  });

  it('parses hours, minutes, and seconds', () => {
    expect(parseTimeout('1h30m45s')).toBe((1 * 3600 + 30 * 60 + 45) * 1000);
  });

  it('parses minutes and seconds', () => {
    expect(parseTimeout('5m30s')).toBe((5 * 60 + 30) * 1000);
  });

  it('parses hours and seconds', () => {
    expect(parseTimeout('1h15s')).toBe((3600 + 15) * 1000);
  });

  it('throws on empty string', () => {
    expect(() => parseTimeout('')).toThrow('Invalid timeout: empty string');
  });

  it('throws on invalid format', () => {
    expect(() => parseTimeout('abc')).toThrow('Invalid timeout format');
  });

  it('throws on bare number without unit', () => {
    expect(() => parseTimeout('30')).toThrow('Invalid timeout format');
  });

  it('throws on zero duration', () => {
    expect(() => parseTimeout('0h0m0s')).toThrow('resolves to zero duration');
  });

  it('trims whitespace', () => {
    expect(parseTimeout(' 15m ')).toBe(15 * 60 * 1000);
  });

  it('parses large values', () => {
    expect(parseTimeout('24h')).toBe(24 * 3600 * 1000);
  });
});
