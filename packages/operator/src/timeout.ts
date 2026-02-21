/**
 * Parse a human-readable timeout string into milliseconds.
 *
 * Supported formats:
 *   "30m"     → 30 * 60 * 1000
 *   "1h"      → 60 * 60 * 1000
 *   "2h30m"   → (2 * 60 + 30) * 60 * 1000
 *   "90s"     → 90 * 1000
 *   "1h30m45s"→ (1 * 3600 + 30 * 60 + 45) * 1000
 *
 * @param timeout - A duration string like "30m", "1h", "2h30m"
 * @returns Duration in milliseconds
 * @throws Error if the format is invalid
 */
export function parseTimeout(timeout: string): number {
  if (!timeout || timeout.trim().length === 0) {
    throw new Error(`Invalid timeout: empty string`);
  }

  const pattern = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
  const match = pattern.exec(timeout.trim());

  if (!match) {
    throw new Error(`Invalid timeout format: "${timeout}". Expected format like "30m", "1h", "2h30m", "90s"`);
  }

  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const seconds = match[3] ? parseInt(match[3], 10) : 0;

  if (hours === 0 && minutes === 0 && seconds === 0) {
    throw new Error(`Invalid timeout: "${timeout}" resolves to zero duration`);
  }

  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}
