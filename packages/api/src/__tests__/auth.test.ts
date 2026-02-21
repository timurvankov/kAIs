import { describe, expect, it } from 'vitest';

import type { StaticTokenEntry } from '@kais/core';
import { StaticTokenAuthProvider, extractBearerToken } from '../auth.js';

// ---------------------------------------------------------------------------
// extractBearerToken
// ---------------------------------------------------------------------------

describe('extractBearerToken', () => {
  it('extracts token from valid Bearer header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('returns undefined for missing header', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractBearerToken('')).toBeUndefined();
  });

  it('returns undefined for non-Bearer scheme', () => {
    expect(extractBearerToken('Basic abc123')).toBeUndefined();
  });

  it('returns undefined for malformed header (no space)', () => {
    expect(extractBearerToken('Bearerabc123')).toBeUndefined();
  });

  it('returns undefined for header with extra parts', () => {
    expect(extractBearerToken('Bearer abc 123')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// StaticTokenAuthProvider
// ---------------------------------------------------------------------------

describe('StaticTokenAuthProvider', () => {
  const tokens: StaticTokenEntry[] = [
    { name: 'timur', token: 'secret-admin-token', roles: ['admin'] },
    { name: 'ci', token: 'ci-token-123', roles: ['researcher'] },
    { name: 'viewer', token: 'view-only', roles: ['observer'] },
  ];

  const provider = new StaticTokenAuthProvider(tokens);

  it('authenticates valid admin token', async () => {
    const user = await provider.authenticate('secret-admin-token');
    expect(user).toEqual({ name: 'timur', roles: ['admin'] });
  });

  it('authenticates valid ci token', async () => {
    const user = await provider.authenticate('ci-token-123');
    expect(user).toEqual({ name: 'ci', roles: ['researcher'] });
  });

  it('returns undefined for unknown token', async () => {
    const user = await provider.authenticate('wrong-token');
    expect(user).toBeUndefined();
  });

  it('returns undefined for empty token', async () => {
    const user = await provider.authenticate('');
    expect(user).toBeUndefined();
  });
});
