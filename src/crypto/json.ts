// Reading JSON that came from outside the page: an envelope, a private-key file, a sealed header.

/** A plain JSON object, so its fields can be read without a cast. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
