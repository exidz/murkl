import { useState, useCallback, useEffect } from 'react';
import type { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from './Button';
import { OtpInput } from './OtpInput';
import { SkeletonCard } from './Skeleton';
import { signInWithDiscord, signInWithTwitter, sendEmailOTP, verifyEmailOTP, getMurklIdentifier, useSession, signOut, type MurklIdentity } from '../lib/auth-client';
import './OAuthLogin.css';

// ─── Provider SVG Icons ──────────────────────────────────────

const DiscordIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const TwitterIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const EmailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

// ─── Provider configs ────────────────────────────────────────

const PROVIDER_META: Record<string, { icon: string; color: string; name: string }> = {
  twitter: { icon: '𝕏', color: '#000000', name: 'Twitter / X' },
  discord: { icon: '💬', color: '#5865F2', name: 'Discord' },
  'email-otp': { icon: '✉️', color: '#3d95ce', name: 'Email' },
};

// ─── Stagger animation config ────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.15,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 350, damping: 28 },
  },
};

// ─── Component ───────────────────────────────────────────────

interface Props {
  onLogin: (provider: string, identity: string) => void;
  loading?: boolean;
  /** When true, skip auto-login and show sign-out + login buttons */
  showSwitch?: boolean;
}

/**
 * Venmo-style OAuth login with branded social buttons.
 *
 * Features:
 * - Provider-specific button styling (X dark, Discord blurple, Email blue)
 * - Animated stagger entrance
 * - Identity picker for multi-account users
 * - Email OTP inline flow
 * - Privacy assurance badge
 * - Accessible with proper ARIA roles
 */
export const OAuthLogin: FC<Props> = ({ onLogin, loading, showSwitch }) => {
  const { data: session, isPending } = useSession();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailStep, setEmailStep] = useState<'idle' | 'enter-email' | 'enter-otp'>('idle');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [linkedIdentities, setLinkedIdentities] = useState<MurklIdentity[] | null>(null);

  // Cooldown timer for resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const LAST_IDENTITY_KEY = 'murkl:last-identity';

  // When session exists, fetch linked identities.
  // If only one → auto-login.
  // If multiple →
  //   - normal mode: auto-select the last-used identity if available, else show picker
  //   - switch mode (showSwitch=true): always show picker (so you can reselect without signing out)
  // Skip if email OTP flow is active (it calls onLogin directly).
  useEffect(() => {
    if (session?.user && !isPending && emailStep === 'idle' && !linkedIdentities) {
      getMurklIdentifier().then((data) => {
        if (!data) return;

        const identities = data.identities || [];

        if (identities.length > 1) {
          if (showSwitch) {
            setLinkedIdentities(identities);
            return;
          }

          // Try to restore last-picked identity (prevents “always picks email on refresh”).
          try {
            const last = localStorage.getItem(LAST_IDENTITY_KEY);
            if (last) {
              const match = identities.find((i) => i.identifier === last);
              if (match) {
                onLogin(match.provider, match.identifier);
                return;
              }
            }
          } catch {
            // ignore localStorage issues
          }

          setLinkedIdentities(identities);
          return;
        }

        if (identities.length === 1) {
          onLogin(identities[0].provider, identities[0].identifier);
          return;
        }

        onLogin(data.provider, data.murklIdentifier);
      });
    }
  }, [session, isPending, onLogin, emailStep, linkedIdentities, showSwitch]);

  // Handle social sign in
  const handleSocialLogin = useCallback(async (provider: 'discord' | 'twitter') => {
    setIsLoggingIn(true);
    setError(null);
    
    try {
      const callbackURL = `${window.location.origin}/?tab=claim`;
      if (provider === 'discord') {
        await signInWithDiscord(callbackURL);
      } else {
        await signInWithTwitter(callbackURL);
      }
    } catch (e) {
      setError('Failed to sign in. Please try again.');
      console.error(`${provider} sign in error:`, e);
    } finally {
      setIsLoggingIn(false);
    }
  }, []);

  // Format cooldown display
  const formatCooldown = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}s`;
  };

  // Handle email OTP send
  const handleSendOtp = useCallback(async () => {
    if (!email || !email.includes('@')) {
      setError('Enter a valid email address');
      return;
    }
    if (cooldown > 0) return;
    setSendingOtp(true);
    setError(null);
    try {
      const result = await sendEmailOTP(email);
      if (result.error) {
        setError(result.error.message || 'Failed to send code.');
      } else {
        setEmailStep('enter-otp');
        setCooldown(300);
      }
    } catch (e: any) {
      if (e?.status === 429 || e?.retryAfter) {
        const retryAfter = e.retryAfter || 300;
        setCooldown(retryAfter);
        setError(`Please wait ${Math.ceil(retryAfter / 60)} minute(s) before resending`);
      } else {
        setError('Failed to send code. Try again.');
      }
      console.error('Send OTP error:', e);
    } finally {
      setSendingOtp(false);
    }
  }, [email, cooldown]);

  // Handle email OTP verify
  const handleVerifyOtp = useCallback(async () => {
    if (otp.length < 6) {
      setError('Enter the 6-digit code');
      return;
    }
    setIsLoggingIn(true);
    setError(null);
    try {
      const result = await verifyEmailOTP(email, otp);
      if (result.error) {
        setError('Invalid or expired code. Try again.');
      } else {
        onLogin('email-otp', `email:${email.toLowerCase().trim()}`);
      }
    } catch (e) {
      setError('Verification failed. Try again.');
      console.error('Verify OTP error:', e);
    } finally {
      setIsLoggingIn(false);
    }
  }, [email, otp, onLogin]);

  // Handle sign out
  const handleSignOut = useCallback(async () => {
    setLinkedIdentities(null);
    try {
      localStorage.removeItem(LAST_IDENTITY_KEY);
    } catch {
      // ignore
    }
    await signOut();
  }, []);

  // Pick a linked identity
  const handlePickIdentity = useCallback((identity: MurklIdentity) => {
    setLinkedIdentities(null);
    try {
      localStorage.setItem(LAST_IDENTITY_KEY, identity.identifier);
    } catch {
      // ignore
    }
    onLogin(identity.provider, identity.identifier);
  }, [onLogin]);

  const isDisabled = loading || isLoggingIn || isPending;

  // ─── RENDER: Multiple linked accounts → identity picker ────

  if (linkedIdentities && linkedIdentities.length > 1 && session?.user) {
    return (
      <div className="oauth-login">
        <div className="oauth-header">
          <motion.div 
            className="oauth-icon"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            {session.user.image ? (
              <img 
                src={session.user.image} 
                alt={session.user.name || 'User'} 
                className="oauth-avatar"
              />
            ) : (
              '👤'
            )}
          </motion.div>
          <motion.h3
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            Which identity?
          </motion.h3>
          <motion.p 
            className="oauth-subtitle"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            You have deposits on multiple accounts
          </motion.p>
        </div>

        <motion.div
          className="identity-picker"
          initial={false}
          animate={{ opacity: 1 }}
        >
          {linkedIdentities.map((identity) => {
            const meta = PROVIDER_META[identity.provider] || { icon: '🔵', color: '#3d95ce', name: identity.provider };
            
            return (
              <motion.button
                key={identity.identifier}
                className="identity-option"
                onClick={() => handlePickIdentity(identity)}
                initial={false}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                whileTap={{ scale: 0.98 }}
                style={{
                  '--provider-color': meta.color,
                  background: 'rgba(255,255,255,0.12)',
                  border: '1px solid rgba(255,255,255,0.22)',
                  boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
                } as React.CSSProperties}
              >
                <div className="identity-option-badge">
                  <span>{meta.icon}</span>
                </div>
                <div className="identity-option-text">
                  <span className="identity-option-id">{identity.identifier}</span>
                  <span className="identity-option-provider">{meta.name}</span>
                </div>
                <span className="identity-option-arrow" aria-hidden="true">→</span>
              </motion.button>
            );
          })}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <Button variant="ghost" onClick={handleSignOut}>
            Sign out
          </Button>
        </motion.div>
      </div>
    );
  }

  // ─── RENDER: Signed in and user wants to re-pick identity ──
  // For multi-linked accounts, this should go back to the identity picker
  // WITHOUT requiring a sign-out.
  if (session?.user && showSwitch) {
    if (linkedIdentities && linkedIdentities.length > 1) {
      // Reuse the same identity picker UI
      return (
        <div className="oauth-login">
          <div className="oauth-header">
            <motion.div 
              className="oauth-icon"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              {session.user.image ? (
                <img 
                  src={session.user.image} 
                  alt={session.user.name || 'User'} 
                  className="oauth-avatar"
                />
              ) : (
                '👤'
              )}
            </motion.div>
            <motion.h3
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              Choose identity
            </motion.h3>
            <motion.p 
              className="oauth-subtitle"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              Pick which account to use
            </motion.p>
          </div>

          <motion.div
            className="identity-picker"
            initial={false}
            animate={{ opacity: 1 }}
          >
            {linkedIdentities.map((identity) => {
              const meta = PROVIDER_META[identity.provider] || { icon: '🔵', color: '#3d95ce', name: identity.provider };

              return (
                <motion.button
                  key={identity.identifier}
                  className="identity-option"
                  onClick={() => handlePickIdentity(identity)}
                  initial={false}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  whileTap={{ scale: 0.98 }}
                  style={{
                    '--provider-color': meta.color,
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.22)',
                    boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
                  } as React.CSSProperties}
                >
                  <div className="identity-option-badge">
                    <span>{meta.icon}</span>
                  </div>
                  <div className="identity-option-text">
                    <span className="identity-option-id">{identity.identifier}</span>
                    <span className="identity-option-provider">{meta.name}</span>
                  </div>
                  <span className="identity-option-arrow" aria-hidden="true">→</span>
                </motion.button>
              );
            })}
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
          >
            <Button variant="ghost" onClick={handleSignOut}>
              Sign out
            </Button>
          </motion.div>
        </div>
      );
    }

    // Single identity: nothing to pick; just keep session.
    return (
      <div className="oauth-login">
        <div className="oauth-header">
          <motion.h3
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            Only one identity linked
          </motion.h3>
          <motion.p
            className="oauth-subtitle"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            You can keep using your current account.
          </motion.p>
        </div>
        <Button variant="ghost" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
    );
  }

  // ─── RENDER: Single account, signed in → loading deposits ──

  if (session?.user) {
    return (
      <div className="oauth-login">
        <div className="oauth-header">
          <motion.div 
            className="oauth-icon has-avatar"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            {session.user.image ? (
              <img 
                src={session.user.image} 
                alt={session.user.name || 'User'} 
                className="oauth-avatar"
              />
            ) : (
              '👤'
            )}
          </motion.div>
          <motion.h3
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            Welcome, {session.user.name}
          </motion.h3>
          <motion.p 
            className="oauth-subtitle"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            Checking your deposits…
          </motion.p>
        </div>
        
        <motion.div
          className="oauth-loading-deposits"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <SkeletonCard />
          <SkeletonCard />
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <Button variant="ghost" onClick={handleSignOut}>
            Sign out
          </Button>
        </motion.div>
      </div>
    );
  }

  // ─── RENDER: Session loading ───────────────────────────────

  if (isPending) {
    return (
      <div className="oauth-login">
        <div className="oauth-header">
          <motion.div
            className="oauth-icon"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            <motion.span
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              🔐
            </motion.span>
          </motion.div>
          <motion.h3
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            Checking session…
          </motion.h3>
        </div>
        <motion.div
          className="oauth-loading-deposits"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
        >
          <SkeletonCard />
        </motion.div>
      </div>
    );
  }

  // ─── RENDER: Main sign-in flow ─────────────────────────────

  return (
    <div className="oauth-login">
      {/* Header */}
      <div className="oauth-header">
        <motion.div 
          className="oauth-icon"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          🔐
        </motion.div>
        <motion.h3
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          Claim your funds
        </motion.h3>
        <motion.p 
          className="oauth-subtitle"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          Sign in to see deposits sent to you
        </motion.p>
      </div>
      
      {/* Error message */}
      <AnimatePresence>
        {error && (
          <motion.div 
            className="oauth-error"
            role="alert"
            initial={{ opacity: 0, y: -10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -10, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <span className="oauth-error-icon" aria-hidden="true">⚠️</span>
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* OAuth buttons or Email OTP flow */}
      <AnimatePresence mode="wait">
        {emailStep === 'idle' ? (
          <motion.div
            key="providers"
            className="oauth-buttons"
            role="group"
            aria-label="Sign in options"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit={{ opacity: 0, y: -10, transition: { duration: 0.15 } }}
          >
            {/* Twitter/X — dark, minimal */}
            <motion.button
              className="oauth-btn oauth-twitter"
              onClick={() => handleSocialLogin('twitter')}
              disabled={isDisabled}
              variants={itemVariants}
              whileTap={{ scale: 0.98 }}
            >
              <span className="oauth-icon-wrapper" aria-hidden="true">
                <TwitterIcon />
              </span>
              <span className="oauth-text">
                {isLoggingIn ? 'Redirecting…' : 'Continue with X'}
              </span>
              <span className="oauth-arrow" aria-hidden="true">→</span>
            </motion.button>
            
            {/* Discord — blurple accent */}
            <motion.button
              className="oauth-btn oauth-discord"
              onClick={() => handleSocialLogin('discord')}
              disabled={isDisabled}
              variants={itemVariants}
              whileTap={{ scale: 0.98 }}
            >
              <span className="oauth-icon-wrapper" aria-hidden="true">
                <DiscordIcon />
              </span>
              <span className="oauth-text">
                {isLoggingIn ? 'Redirecting…' : 'Continue with Discord'}
              </span>
              <span className="oauth-arrow" aria-hidden="true">→</span>
            </motion.button>

            {/* Separator */}
            <motion.div className="oauth-separator" variants={itemVariants} aria-hidden="true">
              <span className="oauth-separator-line" />
              <span className="oauth-separator-text">or</span>
              <span className="oauth-separator-line" />
            </motion.div>

            {/* Email */}
            <motion.button
              className="oauth-btn oauth-email"
              onClick={() => setEmailStep('enter-email')}
              disabled={isDisabled}
              variants={itemVariants}
              whileTap={{ scale: 0.98 }}
            >
              <span className="oauth-icon-wrapper" aria-hidden="true">
                <EmailIcon />
              </span>
              <span className="oauth-text">Continue with Email</span>
              <span className="oauth-arrow" aria-hidden="true">→</span>
            </motion.button>
          </motion.div>

        ) : emailStep === 'enter-email' ? (
          <motion.div
            key="enter-email"
            className="oauth-email-flow"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="oauth-email-input-wrapper">
              <div className="oauth-email-input-container">
                <span className="oauth-email-input-icon" aria-hidden="true">✉️</span>
                <input
                  type="email"
                  className="oauth-email-input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendOtp()}
                  autoFocus
                  autoComplete="email"
                  aria-label="Email address"
                />
              </div>
            </div>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleSendOtp}
              loading={sendingOtp}
              loadingText="Sending code…"
              disabled={!email || !email.includes('@')}
            >
              Send verification code
            </Button>
            <button
              className="oauth-back-link"
              onClick={() => { setEmailStep('idle'); setError(null); }}
              aria-label="Go back to other sign in options"
            >
              ← Other sign in options
            </button>
          </motion.div>

        ) : (
          <motion.div
            key="enter-otp"
            className="oauth-email-flow"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="oauth-otp-header">
              <span className="oauth-otp-icon" aria-hidden="true">📬</span>
              <p className="oauth-otp-sent">
                Code sent to <strong>{email}</strong>
              </p>
            </div>
            <OtpInput
              value={otp}
              onChange={setOtp}
              onComplete={handleVerifyOtp}
              length={6}
              autoFocus
            />
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleVerifyOtp}
              loading={isLoggingIn}
              loadingText="Verifying…"
              disabled={otp.length !== 6}
            >
              Verify & sign in
            </Button>
            <div className="oauth-otp-actions">
              <button
                className="oauth-back-link"
                onClick={() => { handleSendOtp(); }}
                disabled={cooldown > 0 || sendingOtp}
                aria-label={cooldown > 0 ? `Resend code available in ${formatCooldown(cooldown)}` : 'Resend verification code'}
              >
                {sendingOtp ? 'Sending…' : cooldown > 0 ? `Resend in ${formatCooldown(cooldown)}` : 'Resend code'}
              </button>
              <button
                className="oauth-back-link"
                onClick={() => { setEmailStep('enter-email'); setOtp(''); setError(null); }}
                aria-label="Change email address"
              >
                Change email
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Privacy note */}
      <motion.div 
        className="oauth-privacy"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
      >
        <div className="oauth-privacy-badge">
          <span className="oauth-privacy-icon" aria-hidden="true">🛡️</span>
        </div>
        <div className="oauth-privacy-content">
          <p className="oauth-privacy-title">Your identity stays private</p>
          <p className="oauth-privacy-detail">
            We only check if deposits were sent to your handle — nothing else
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default OAuthLogin;
