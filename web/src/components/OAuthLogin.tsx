import { useState, useCallback, useRef, useEffect } from 'react';
import type { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from './Button';
import './OAuthLogin.css';

interface OAuthProvider {
  id: 'twitter' | 'discord' | 'google';
  name: string;
  icon: React.ReactNode;
  placeholder: string;
  prefix: string;
}

// SVG icons for providers
const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const DiscordIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const providers: OAuthProvider[] = [
  { id: 'twitter', name: 'X (Twitter)', icon: <XIcon />, placeholder: 'satoshi', prefix: '@' },
  { id: 'discord', name: 'Discord', icon: <DiscordIcon />, placeholder: 'vitalik', prefix: '' },
  { id: 'google', name: 'Google', icon: <GoogleIcon />, placeholder: 'you@gmail.com', prefix: '' },
];

interface Props {
  onLogin: (provider: string, identity: string) => void;
  loading?: boolean;
}

/**
 * Venmo-style OAuth login with inline identity input sheet.
 * No browser prompts - everything stays in the app UI.
 */
export const OAuthLogin: FC<Props> = ({ onLogin, loading }) => {
  const [selectedProvider, setSelectedProvider] = useState<OAuthProvider | null>(null);
  const [identity, setIdentity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when sheet opens
  useEffect(() => {
    if (selectedProvider) {
      const timer = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
  }, [selectedProvider]);

  // Reset identity when provider changes
  useEffect(() => {
    setIdentity('');
  }, [selectedProvider?.id]);

  // Handle provider selection
  const handleProviderClick = useCallback((provider: OAuthProvider) => {
    setSelectedProvider(provider);
  }, []);

  // Handle identity submission
  const handleSubmit = useCallback(async () => {
    if (!selectedProvider || !identity.trim()) return;
    
    setIsSubmitting(true);
    
    // Format identity with prefix if needed
    let formattedIdentity = identity.trim();
    if (selectedProvider.prefix && !formattedIdentity.startsWith(selectedProvider.prefix)) {
      formattedIdentity = selectedProvider.prefix + formattedIdentity;
    }
    
    // Brief delay for UX feedback
    await new Promise(r => setTimeout(r, 400));
    
    onLogin(selectedProvider.id, formattedIdentity);
    setSelectedProvider(null);
    setIdentity('');
    setIsSubmitting(false);
  }, [selectedProvider, identity, onLogin]);

  // Handle enter key
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && identity.trim()) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setSelectedProvider(null);
    }
  }, [identity, handleSubmit]);

  // Close sheet
  const handleClose = useCallback(() => {
    setSelectedProvider(null);
    setIdentity('');
  }, []);

  const isDisabled = loading || isSubmitting;

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
      
      {/* OAuth buttons */}
      <div className="oauth-buttons" role="group" aria-label="Sign in options">
        {providers.map((provider, index) => (
          <motion.button
            key={provider.id}
            className={`oauth-btn oauth-${provider.id}`}
            onClick={() => handleProviderClick(provider)}
            disabled={isDisabled}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + index * 0.05 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="oauth-icon-wrapper" aria-hidden="true">
              {provider.icon}
            </span>
            <span className="oauth-text">
              Continue with {provider.name}
            </span>
          </motion.button>
        ))}
      </div>

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

      {/* Identity input bottom sheet */}
      <AnimatePresence>
        {selectedProvider && (
          <>
            <motion.div 
              className="identity-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleClose}
            />
            <motion.div 
              className="identity-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
            >
              <div className="sheet-handle" onClick={handleClose} />
              
              <div className="identity-sheet-content">
                {/* Header with provider icon */}
                <div className="identity-sheet-header">
                  <motion.div 
                    className={`identity-provider-icon oauth-${selectedProvider.id}`}
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', delay: 0.1 }}
                  >
                    {selectedProvider.icon}
                  </motion.div>
                  <motion.h4
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                  >
                    Enter your {selectedProvider.name} handle
                  </motion.h4>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.15 }}
                  >
                    This is where your funds were sent
                  </motion.p>
                </div>

                {/* Input field */}
                <motion.div 
                  className="identity-input-wrapper"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                >
                  {selectedProvider.prefix && (
                    <span className="identity-prefix">{selectedProvider.prefix}</span>
                  )}
                  <input
                    ref={inputRef}
                    type={selectedProvider.id === 'google' ? 'email' : 'text'}
                    className="identity-input"
                    placeholder={selectedProvider.placeholder}
                    value={identity}
                    onChange={e => setIdentity(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    disabled={isSubmitting}
                  />
                </motion.div>

                {/* Hint text */}
                <motion.p 
                  className="identity-hint"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  {selectedProvider.id === 'twitter' && 'Your X/Twitter username (we\'ll add the @)'}
                  {selectedProvider.id === 'discord' && 'Your Discord username'}
                  {selectedProvider.id === 'google' && 'Your Gmail or Google account email'}
                </motion.p>

                {/* Actions */}
                <motion.div 
                  className="identity-actions"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <Button 
                    variant="ghost"
                    onClick={handleClose}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button 
                    variant="primary"
                    onClick={handleSubmit}
                    disabled={!identity.trim()}
                    loading={isSubmitting}
                    loadingText="Checking..."
                  >
                    Continue
                  </Button>
                </motion.div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OAuthLogin;
