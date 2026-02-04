import { createAuthClient } from 'better-auth/react';

// Get the relayer URL from constants or environment
const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || 'http://localhost:3001';

export const authClient = createAuthClient({
  baseURL: RELAYER_URL,
});

// Re-export hooks for convenience
export const { useSession, signIn, signOut } = authClient;

/**
 * Sign in with Discord and get the Murkl identifier
 */
export async function signInWithDiscord(callbackURL?: string) {
  return authClient.signIn.social({
    provider: 'discord',
    callbackURL: callbackURL || window.location.href,
  });
}

/**
 * Get the current user's Murkl identifier from the /api/me endpoint
 */
export async function getMurklIdentifier(): Promise<{
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
  provider: string;
  murklIdentifier: string;
} | null> {
  try {
    const response = await fetch(`${RELAYER_URL}/api/me`, {
      credentials: 'include',
    });
    
    if (!response.ok) {
      return null;
    }
    
    return response.json();
  } catch {
    return null;
  }
}
