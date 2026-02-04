import { useState, type FC } from 'react';
import { motion } from 'framer-motion';
import { Button } from './Button';

interface Deposit {
  amount: number;
  token: string;
}

export interface PasswordSheetProps {
  deposit: Deposit;
  password: string;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  wasmReady: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Improved password entry bottom sheet with:
 * - Show/hide toggle for password visibility
 * - Character count indicator
 * - Visual feedback while typing
 */
export const PasswordSheet: FC<PasswordSheetProps> = ({
  deposit,
  password,
  onPasswordChange,
  onSubmit,
  onClose,
  wasmReady,
  inputRef,
}) => {
  const [showPassword, setShowPassword] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && password) {
      e.preventDefault();
      onSubmit();
    }
  };

  // Password readiness indicator
  const isReady = password.length >= 8;

  return (
    <>
      <motion.div
        className="sheet-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="password-sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        <div className="sheet-handle" onClick={onClose} />

        <div className="sheet-content">
          <div className="sheet-header">
            <motion.span
              className="sheet-icon"
              animate={{
                scale: password.length > 0 ? [1, 1.1, 1] : 1,
              }}
              transition={{ duration: 0.2 }}
              key={password.length > 0 ? 'active' : 'idle'}
            >
              {isReady ? '🔓' : '🔑'}
            </motion.span>
            <h3>Enter Password</h3>
            <p>Claim {deposit.amount} {deposit.token}</p>
          </div>

          <div className="password-input-wrapper">
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              className={`password-input ${password.length > 0 ? 'has-value' : ''} ${isReady ? 'ready' : ''}`}
              placeholder="Password..."
              value={password}
              onChange={e => onPasswordChange(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
            <motion.button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword(!showPassword)}
              whileTap={{ scale: 0.9 }}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? '🙈' : '👁️'}
            </motion.button>
          </div>

          {/* Character count / ready indicator */}
          <motion.div
            className={`password-hint ${isReady ? 'ready' : ''}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            {password.length === 0 ? (
              <span>Enter the password shared by sender</span>
            ) : isReady ? (
              <motion.span
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                className="ready-text"
              >
                ✓ Ready to claim
              </motion.span>
            ) : (
              <span>{password.length}/8 characters minimum</span>
            )}
          </motion.div>

          <div className="sheet-actions">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={onSubmit}
              disabled={!password || password.length < 8}
              loading={!wasmReady}
              loadingText="Loading..."
            >
              Claim
            </Button>
          </div>
        </div>
      </motion.div>
    </>
  );
};

export default PasswordSheet;
