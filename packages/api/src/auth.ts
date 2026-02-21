import type { AuthUser, StaticTokenEntry } from '@kais/core';

/**
 * Authenticate a request using a Bearer token from the Authorization header.
 * Returns the AuthUser if valid, undefined otherwise.
 */
export interface AuthProvider {
  authenticate(token: string): Promise<AuthUser | undefined>;
}

/**
 * Static token auth provider — tokens are defined in config.
 * Suitable for personal/CI use cases.
 */
export class StaticTokenAuthProvider implements AuthProvider {
  private readonly tokenMap: Map<string, AuthUser>;

  constructor(tokens: StaticTokenEntry[]) {
    this.tokenMap = new Map(
      tokens.map((t) => [t.token, { name: t.name, roles: t.roles }]),
    );
  }

  async authenticate(token: string): Promise<AuthUser | undefined> {
    return this.tokenMap.get(token);
  }
}

/**
 * Extract a Bearer token from an Authorization header value.
 * Returns undefined if the header is missing or malformed.
 */
export function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return undefined;
  return parts[1];
}
