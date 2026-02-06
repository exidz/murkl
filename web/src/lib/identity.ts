export interface IdentityMeta {
  /** Friendly display name for UI (no internal namespace) */
  display: string;
  /** Provider label for UI (e.g. X, Discord, Email) */
  providerLabel: string | null;
  /** Small icon/emoji/text for UI */
  icon: string;
}

/**
 * Parse Murkl's namespaced identity strings into friendly UI metadata.
 *
 * Supported formats:
 * - twitter:@handle
 * - discord:username
 * - email:user@example.com
 * - (fallback) anything else
 */
export function getIdentityMeta(identifier: string): IdentityMeta {
  const raw = (identifier || '').trim();
  const lower = raw.toLowerCase();

  if (lower.startsWith('twitter:')) {
    const handle = raw.slice('twitter:'.length);
    const at = handle.startsWith('@') ? handle : `@${handle}`;
    return { icon: '𝕏', providerLabel: 'X', display: at };
  }

  if (lower.startsWith('discord:')) {
    const name = raw.slice('discord:'.length);
    return { icon: '🎮', providerLabel: 'Discord', display: name };
  }

  if (lower.startsWith('email:')) {
    const addr = raw.slice('email:'.length);
    // Prefer showing full address here; it’s clearer for “is this me?”
    return { icon: '✉️', providerLabel: 'Email', display: addr };
  }

  return { icon: '👤', providerLabel: null, display: raw };
}
