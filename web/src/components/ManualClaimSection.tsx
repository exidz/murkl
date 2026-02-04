import { useState, useCallback, useRef, useEffect, type FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from './Button';

interface Props {
  onLogin: (provider: string, handle: string) => void;
}

/**
 * Manual claim section with expandable input.
 * For users who have a claim link or want to enter identity manually.
 */
export const ManualClaimSection: FC<Props> = ({ onLogin }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(() => {
    if (!input.trim()) return;

    // Parse claim link or use as identifier
    let identifier = input.trim();

    // Try to extract from URL if it looks like a link
    if (identifier.includes('://') || identifier.includes('?')) {
      try {
        const url = new URL(identifier.startsWith('http') ? identifier : `https://${identifier}`);
        const id = url.searchParams.get('id') || url.searchParams.get('identity');
        if (id) identifier = id;
      } catch {
        // Not a valid URL, use as-is
      }
    }

    onLogin('manual', identifier);
    setInput('');
    setIsOpen(false);
  }, [input, onLogin]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <motion.div
      className="manual-claim-section"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.5 }}
    >
      <AnimatePresence mode="wait">
        {!isOpen ? (
          <motion.button
            key="trigger"
            className="manual-claim-trigger"
            onClick={() => setIsOpen(true)}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <span className="trigger-icon">🔗</span>
            <span className="trigger-text">Have a claim link?</span>
            <span className="trigger-arrow">→</span>
          </motion.button>
        ) : (
          <motion.div
            key="form"
            className="manual-claim-form"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <div className="manual-claim-header">
              <button
                className="manual-claim-back"
                onClick={() => setIsOpen(false)}
              >
                ← Back
              </button>
              <h4>Enter claim link or identity</h4>
            </div>

            <input
              ref={inputRef}
              type="text"
              className="manual-claim-input"
              placeholder="Paste link or @handle..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
            />

            <Button
              variant="primary"
              fullWidth
              onClick={handleSubmit}
              disabled={!input.trim()}
            >
              Continue
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default ManualClaimSection;
