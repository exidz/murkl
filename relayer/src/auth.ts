import { betterAuth } from 'better-auth';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Load Discord OAuth credentials
const secretsPath = process.env.DISCORD_OAUTH_PATH || 
  path.join(process.env.HOME || '', '.openclaw', '.secrets', 'discord-oauth.json');

let discordConfig = { clientId: '', clientSecret: '' };
try {
  if (fs.existsSync(secretsPath)) {
    discordConfig = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
  }
} catch (e) {
  console.error('Failed to load Discord OAuth config:', e);
}

// Database path
const dbPath = process.env.AUTH_DB_PATH || path.join(process.cwd(), 'auth.db');

// Initialize Better Auth
const db = new Database(dbPath);

export const auth = betterAuth({
  database: db as any, // Type assertion to avoid TS4023
  
  // Base URL for callbacks
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3001',
  
  // Trusted origins for CORS
  trustedOrigins: [
    'http://localhost:5173',
    'http://localhost:5174', 
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'https://murkl.app',
    'https://murkl.dev',
  ],
  
  // Secret for signing sessions
  secret: process.env.BETTER_AUTH_SECRET || 'murkl-dev-secret-change-in-production-32chars!',
  
  // Social providers
  socialProviders: {
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID || discordConfig.clientId,
      clientSecret: process.env.DISCORD_CLIENT_SECRET || discordConfig.clientSecret,
    },
  },
  
  // Session configuration
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },
  
  // Account linking
  account: {
    accountLinking: {
      enabled: true,
    },
  },
});

/**
 * Get the Murkl identifier from a user's session.
 * For Discord: returns the Discord username (for use as deposit identifier)
 */
export function getMurklIdentifier(user: { 
  email?: string | null;
  name?: string | null;
  id: string;
}, provider: string): string {
  // For Discord, use the username/name as identifier
  // This matches how deposits are sent (to Discord usernames)
  if (provider === 'discord' && user.name) {
    return user.name; // Discord username without discriminator
  }
  
  // Fallback to email for other providers
  if (user.email) {
    return user.email;
  }
  
  // Last resort: use user ID
  return `user:${user.id}`;
}

export type Auth = typeof auth;
