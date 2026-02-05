import { useState, useCallback, useEffect } from 'react';
import type { FC } from 'react';
import { motion } from 'framer-motion';
import { Button } from './Button';
import { signInWithDiscord, signInWithTwitter, sendEmailOTP, verifyEmailOTP, getMurklIdentifier, useSession, signOut } from '../lib/auth-client';
import './OAuthLogin.css';

// SVG icons for providers
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

interface Props {
  onLogin: (provider: string, identity: string) => void;
  loading?: boolean;
}

/**
 * OAuth login using Better Auth.
 * Currently supports Discord - more providers can be added later.
 */
export const OAuthLogin: FC<Props> = ({ onLogin, loading }) => {
  const { data: session, isPending } = useSession();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailStep, setEmailStep] = useState<'idle' | 'enter-email' | 'enter-otp'>('idle');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Cooldown timer for resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // When session becomes available, get the Murkl identifier
  useEffect(() => {
    if (session?.user && !isPending) {
      getMurklIdentifier().then((data) => {
        if (data) {
          onLogin(data.provider, data.murklIdentifier);
        }
      });
    }
  }, [session, isPending, onLogin]);

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
        // Check for rate limit from server
        setError(result.error.message || 'Failed to send code.');
      } else {
        setEmailStep('enter-otp');
        setCooldown(300); // 5 minutes
      }
    } catch (e: any) {
      // Handle 429 rate limit response
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
      }
      // Session hook will pick up the new session automatically
    } catch (e) {
      setError('Verification failed. Try again.');
      console.error('Verify OTP error:', e);
    } finally {
      setIsLoggingIn(false);
    }
  }, [email, otp]);

  // Handle sign out
  const handleSignOut = useCallback(async () => {
    await signOut();
  }, []);

  const isDisabled = loading || isLoggingIn || isPending;

  // If already signed in, show current user
  if (session?.user) {
    return (
      <div className="oauth-login oauth-logged-in">
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
            Signed in as {session.user.name}
          </motion.h3>
          <motion.p 
            className="oauth-subtitle"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            Loading your deposits...
          </motion.p>
        </div>
        
        <Button variant="ghost" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
    );
  }

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
          Sign in to see deposits sent to your identity
        </motion.p>
      </div>
      
      {/* Error message */}
      {error && (
        <motion.div 
          className="oauth-error"
          role="alert"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {error}
        </motion.div>
      )}
      
      {/* OAuth buttons or Email OTP flow */}
      {emailStep === 'idle' ? (
        <div className="oauth-buttons" role="group" aria-label="Sign in options">
          <motion.button
            className="oauth-btn oauth-twitter"
            onClick={() => handleSocialLogin('twitter')}
            disabled={isDisabled}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="oauth-icon-wrapper" aria-hidden="true">
              <TwitterIcon />
            </span>
            <span className="oauth-text">
              {isLoggingIn ? 'Signing in...' : 'Continue with X'}
            </span>
          </motion.button>
          
          <motion.button
            className="oauth-btn oauth-discord"
            onClick={() => handleSocialLogin('discord')}
            disabled={isDisabled}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="oauth-icon-wrapper" aria-hidden="true">
              <DiscordIcon />
            </span>
            <span className="oauth-text">
              {isLoggingIn ? 'Signing in...' : 'Continue with Discord'}
            </span>
          </motion.button>

          <motion.button
            className="oauth-btn oauth-email"
            onClick={() => setEmailStep('enter-email')}
            disabled={isDisabled}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="oauth-icon-wrapper oauth-icon-emoji" aria-hidden="true">
              ✉️
            </span>
            <span className="oauth-text">Continue with Email</span>
          </motion.button>
        </div>
      ) : emailStep === 'enter-email' ? (
        <motion.div
          className="oauth-email-flow"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="oauth-email-input-wrapper">
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
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleSendOtp}
            loading={sendingOtp}
            loadingText="Sending code..."
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
          className="oauth-email-flow"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="oauth-otp-sent">
            Code sent to <strong>{email}</strong>
          </p>
          <div className="oauth-otp-input-wrapper">
            <input
              type="text"
              className="oauth-otp-input"
              placeholder="000000"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()}
              autoFocus
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              aria-label="6-digit verification code"
            />
          </div>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleVerifyOtp}
            loading={isLoggingIn}
            loadingText="Verifying..."
            disabled={otp.length < 6}
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
              {sendingOtp ? 'Sending...' : cooldown > 0 ? `Resend in ${formatCooldown(cooldown)}` : 'Resend code'}
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

      {/* Privacy note */}
      <motion.div 
        className="oauth-privacy"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <span className="oauth-privacy-icon" aria-hidden="true">🛡️</span>
        <p>
          <strong>Your identity stays private.</strong> We only check if deposits were sent to your handle — nothing else.
        </p>
      </motion.div>
    </div>
  );
};

export default OAuthLogin;
