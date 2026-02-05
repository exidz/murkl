import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';

// In dev: Vite proxies /api/* to localhost:3001 (same origin, no CORS)
// In prod: relayer serves frontend (same origin)
const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || '';

export const authClient = createAuthClient({
  baseURL: RELAYER_URL || window.location.origin,
  plugins: [
    emailOTPClient(),
  ],
});

// Re-export hooks for convenience
export const { useSession, signIn, signOut, emailOtp } = authClient;

/** Build an absolute callback URL on the frontend origin */
function getCallbackURL(path?: string): string {
  const base = window.location.origin; // e.g. http://localhost:5173
  return `${base}${path || '/?tab=claim'}`;
}

/**
 * Sign in with Discord and get the Murkl identifier
 */
export async function signInWithDiscord(callbackURL?: string) {
  return authClient.signIn.social({
    provider: 'discord',
    callbackURL: callbackURL || getCallbackURL('/claim'),
  });
}

/**
 * Sign in with Twitter/X and get the Murkl identifier
 */
export async function signInWithTwitter(callbackURL?: string) {
  return authClient.signIn.social({
    provider: 'twitter',
    callbackURL: callbackURL || getCallbackURL('/claim'),
  });
}

/**
 * Send email OTP for sign-in
 */
export async function sendEmailOTP(email: string) {
  return authClient.emailOtp.sendVerificationOtp({
    email,
    type: 'sign-in',
  });
}

/**
 * Verify email OTP and sign in
 */
export async function verifyEmailOTP(email: string, otp: string) {
  return authClient.signIn.emailOtp({
    email,
    otp,
  });
}

export interface MurklIdentity {
  provider: string;
  identifier: string;
  label: string;
}

export interface MeResponse {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
  identities: MurklIdentity[];
  provider: string;
  murklIdentifier: string;
}

/**
 * Get the current user's linked identities from the /api/me endpoint
 */
export async function getMurklIdentifier(): Promise<MeResponse | null> {
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
