export const FULL_KEY_LENGTH = 51;

export function maskKey(
  fullKey: string | null | undefined,
  keyPrefix: string,
  revealed: boolean
): string {
  if (revealed) {
    if (fullKey) return fullKey;
    const prefix = keyPrefix.replace(/\.\.\.$/, "");
    return `${prefix}${"•".repeat(Math.max(0, FULL_KEY_LENGTH - prefix.length))}`;
  }
  return "•".repeat(FULL_KEY_LENGTH);
}
