import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db';
import { emailOTP } from 'better-auth/plugins';
import Database from 'better-sqlite3';
import { Resend } from 'resend';
import path from 'path';
import fs from 'fs';

// Load OAuth credentials from secrets
const secretsDir = path.join(process.env.HOME || '', '.openclaw', '.secrets');

function loadOAuthConfig(filename: string): { clientId: string; clientSecret: string } {
  const filePath = path.join(secretsDir, filename);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`Failed to load ${filename}:`, e);
  }
  return { clientId: '', clientSecret: '' };
}

const discordConfig = loadOAuthConfig('discord-oauth.json');
const twitterConfig = loadOAuthConfig('twitter-oauth.json');

// Load Resend API key for email OTP
function loadSecret(filename: string): string {
  const filePath = path.join(secretsDir, filename);
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8').trim();
    }
  } catch (e) {
    console.error(`Failed to load ${filename}:`, e);
  }
  return '';
}

const resendApiKey = process.env.RESEND_API_KEY || loadSecret('resend-api-key.txt');
export const resend = resendApiKey ? new Resend(resendApiKey) : null;

// OTP rate limiting is enforced at Express middleware level (index.ts)

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
    'https://murkl-relayer-production.up.railway.app',
    ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
  ],
  
  // Secret for signing sessions
  secret: process.env.BETTER_AUTH_SECRET || 'murkl-dev-secret-change-in-production-32chars!',
  
  // Social providers
  socialProviders: {
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID || discordConfig.clientId,
      clientSecret: process.env.DISCORD_CLIENT_SECRET || discordConfig.clientSecret,
    },
    twitter: {
      clientId: process.env.TWITTER_CLIENT_ID || twitterConfig.clientId,
      clientSecret: process.env.TWITTER_CLIENT_SECRET || twitterConfig.clientSecret,
      // Store @handle as name, not display name
      mapProfileToUser: (profile: any) => ({
        name: profile.username || profile.data?.username || profile.name,
      }),
    },
  },
  
  // Plugins
  plugins: [
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        console.log(`📧 Sending ${type} OTP to ${email}: ${otp}`);
        
        if (!resend) {
          console.warn('⚠️ Resend not configured — OTP logged to console only');
          return;
        }
        
        const subject = type === 'sign-in' 
          ? `Your Murkl login code: ${otp}`
          : type === 'email-verification'
          ? `Verify your email: ${otp}`
          : `Reset your password: ${otp}`;
        
        // Use verified domain in prod, Resend test sender in dev
        const fromAddress = process.env.EMAIL_FROM || 'Murkl <noreply@email.siklab.dev>';
        
        try {
          const result = await resend.emails.send({
            from: fromAddress,
            to: email,
            subject,
            html: `
              <div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto; padding: 2rem;">
                <h2 style="color: #fff; margin-bottom: 0.5rem;">🐈‍⬛ Murkl</h2>
                <p style="color: #a1a1aa; font-size: 0.95rem;">Your verification code:</p>
                <div style="background: #14141f; border: 1px solid #27272a; border-radius: 12px; padding: 1.5rem; text-align: center; margin: 1rem 0;">
                  <span style="font-size: 2rem; font-weight: 700; letter-spacing: 0.3em; color: #fff;">${otp}</span>
                </div>
                <p style="color: #71717a; font-size: 0.85rem;">This code expires in 5 minutes. Don't share it with anyone.</p>
              </div>
            `,
          });
          console.log(`✅ OTP email sent to ${email}`, result);
        } catch (err) {
          console.error(`❌ Failed to send OTP email to ${email}:`, err);
          throw err; // Let Better Auth know it failed
        }
      },
      otpLength: 6,
      expiresIn: 300, // 5 minutes
      sendVerificationOnSignUp: false,
    }),
  ],
  
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
  // Namespaced format: <provider>:<handle>
  // This prevents cross-provider impersonation (same username on different platforms)
  if (provider === 'discord' && user.name) {
    return `discord:${user.name}`;
  }
  
  if (provider === 'twitter' && user.name) {
    return `twitter:@${user.name}`;
  }
  
  if (provider === 'google' && user.email) {
    return `google:${user.email}`;
  }
  
  // Email OTP or any email-based provider
  if ((provider === 'email-otp' || provider === 'credential' || provider === 'email') && user.email) {
    return `email:${user.email}`;
  }
  
  // Fallback to email
  if (user.email) {
    return `email:${user.email}`;
  }
  
  // Last resort
  return `user:${user.id}`;
}

export type Auth = typeof auth;

/**
 * Run Better Auth migrations on startup (creates tables if missing).
 * Safe to call repeatedly — only creates/alters what's needed.
 */
export async function runAuthMigrations(): Promise<void> {
  try {
    const { runMigrations, toBeCreated, toBeAdded } = await getMigrations(auth.options);
    if (toBeCreated.length > 0 || toBeAdded.length > 0) {
      console.log(`🔄 Running auth migrations: ${toBeCreated.length} tables to create, ${toBeAdded.length} to alter`);
      await runMigrations();
      console.log('✅ Auth migrations complete');
    } else {
      console.log('✅ Auth database up to date');
    }
  } catch (err) {
    console.error('❌ Auth migration failed:', err);
    throw err;
  }
}
