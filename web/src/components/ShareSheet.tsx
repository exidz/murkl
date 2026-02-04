import { 
  useState, 
  useCallback, 
  useRef, 
  useEffect,
  type FC, 
  type TouchEvent 
} from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import toast from './Toast';
import './ShareSheet.css';

interface ShareData {
  /** Claim link URL */
  link: string;
  /** Password to share */
  password: string;
  /** Amount being shared */
  amount: string;
  /** Token symbol */
  token: string;
  /** Recipient identifier */
  recipient: string;
}

interface Props {
  /** Whether the sheet is open */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
  /** Data to share */
  data: ShareData | null;
}

// Trigger haptic feedback
const triggerHaptic = (pattern: number | number[] = 10) => {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Silently fail
    }
  }
};

// Check if Web Share API is available
const canShare = typeof navigator !== 'undefined' && 
  'share' in navigator && 
  navigator.canShare?.({ text: 'test', url: 'https://test.com' });

/**
 * Venmo-style bottom sheet for sharing claim links.
 * 
 * Features:
 * - Swipe down to dismiss
 * - Native share on mobile (Web Share API)
 * - QR code for scanning
 * - Copy buttons for link + password
 * - Smooth animations
 */
export const ShareSheet: FC<Props> = ({ isOpen, onClose, data }) => {
  const [copiedField, setCopiedField] = useState<'link' | 'password' | 'all' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragY, setDragY] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ y: number; time: number } | null>(null);
  const reducedMotion = useReducedMotion();

  // Reset copied state after delay
  useEffect(() => {
    if (copiedField) {
      const timer = setTimeout(() => setCopiedField(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [copiedField]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  // Copy to clipboard
  const copyToClipboard = useCallback(async (text: string, field: 'link' | 'password' | 'all') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      triggerHaptic(10);
      toast.success(field === 'all' ? 'Copied link & password!' : `Copied ${field}!`);
    } catch {
      toast.error('Failed to copy');
    }
  }, []);

  // Copy both link and password formatted nicely
  const copyAll = useCallback(async () => {
    if (!data) return;
    
    const text = `Hey! I sent you ${data.amount} ${data.token} privately via Murkl 🐈‍⬛

Claim here: ${data.link}

Password: ${data.password}

(Only you can claim this!)`;
    
    await copyToClipboard(text, 'all');
  }, [data, copyToClipboard]);

  // Native share (mobile)
  const handleNativeShare = useCallback(async () => {
    if (!data || !canShare) return;
    
    try {
      await navigator.share({
        title: `${data.amount} ${data.token} from Murkl`,
        text: `Hey! I sent you ${data.amount} ${data.token} privately.\n\nPassword: ${data.password}`,
        url: data.link,
      });
      triggerHaptic([10, 5, 10]);
    } catch (e) {
      // User cancelled or share failed
      if ((e as Error).name !== 'AbortError') {
        toast.error('Share failed');
      }
    }
  }, [data]);

  // Touch handlers for swipe-to-dismiss
  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartRef.current = {
      y: e.touches[0].clientY,
      time: Date.now(),
    };
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current) return;
    
    const deltaY = e.touches[0].clientY - touchStartRef.current.y;
    
    // Only allow dragging down
    if (deltaY > 0) {
      setIsDragging(true);
      setDragY(deltaY);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current) return;
    
    const velocity = isDragging ? dragY / (Date.now() - touchStartRef.current.time) : 0;
    
    // Close if dragged far enough or with enough velocity
    if (dragY > 150 || velocity > 0.5) {
      triggerHaptic(15);
      onClose();
    }
    
    touchStartRef.current = null;
    setIsDragging(false);
    setDragY(0);
  }, [dragY, isDragging, onClose]);

  if (!data) return null;

  // Calculate drag transform
  const sheetStyle = isDragging ? {
    transform: `translateY(${dragY}px)`,
    transition: 'none',
  } : {};

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="share-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0.1 : 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Sheet */}
          <motion.div
            ref={sheetRef}
            className="share-sheet"
            style={sheetStyle}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{
              type: reducedMotion ? 'tween' : 'spring',
              damping: 30,
              stiffness: 300,
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-title"
          >
            {/* Handle for swipe */}
            <div className="share-handle" onClick={onClose}>
              <div className="share-handle-bar" />
            </div>

            {/* Content */}
            <div className="share-content">
              {/* Header */}
              <header className="share-header">
                <h2 id="share-title">Share with {data.recipient}</h2>
                <p className="share-subtitle">
                  Send these details securely (call, text, Signal...)
                </p>
              </header>

              {/* Amount summary */}
              <div className="share-summary">
                <span className="share-amount">{data.amount}</span>
                <span className="share-token">{data.token}</span>
              </div>

              {/* QR Code section */}
              <motion.div 
                className="share-qr"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.1 }}
              >
                <div className="qr-wrapper">
                  <QRCodeSVG
                    value={data.link}
                    size={160}
                    bgColor="#ffffff"
                    fgColor="#0a0a0f"
                    level="M"
                    includeMargin={false}
                  />
                  <span className="qr-icon">🐈‍⬛</span>
                </div>
                <p className="qr-hint">Scan to claim</p>
              </motion.div>

              {/* Actions */}
              <div className="share-actions">
                {/* Native share button (mobile) */}
                {canShare && (
                  <motion.button
                    className="share-action-btn primary"
                    onClick={handleNativeShare}
                    whileTap={{ scale: 0.98 }}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                  >
                    <span className="action-icon">📤</span>
                    <span>Share</span>
                  </motion.button>
                )}

                {/* Copy all */}
                <motion.button
                  className={`share-action-btn ${copiedField === 'all' ? 'copied' : ''} ${!canShare ? 'primary' : ''}`}
                  onClick={copyAll}
                  whileTap={{ scale: 0.98 }}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: canShare ? 0.2 : 0.15 }}
                >
                  <span className="action-icon">
                    {copiedField === 'all' ? '✓' : '📋'}
                  </span>
                  <span>{copiedField === 'all' ? 'Copied!' : 'Copy All'}</span>
                </motion.button>
              </div>

              {/* Individual fields */}
              <div className="share-fields">
                {/* Password */}
                <motion.div 
                  className="share-field"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 }}
                >
                  <div className="field-header">
                    <label>Password</label>
                    <span className="field-badge">🔑 Required</span>
                  </div>
                  <div className="field-row">
                    <code className="field-value">{data.password}</code>
                    <button
                      className={`field-copy ${copiedField === 'password' ? 'copied' : ''}`}
                      onClick={() => copyToClipboard(data.password, 'password')}
                      aria-label="Copy password"
                    >
                      {copiedField === 'password' ? '✓' : '📋'}
                    </button>
                  </div>
                </motion.div>

                {/* Link */}
                <motion.div 
                  className="share-field"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <div className="field-header">
                    <label>Claim Link</label>
                  </div>
                  <div className="field-row">
                    <code className="field-value truncate">{data.link}</code>
                    <button
                      className={`field-copy ${copiedField === 'link' ? 'copied' : ''}`}
                      onClick={() => copyToClipboard(data.link, 'link')}
                      aria-label="Copy link"
                    >
                      {copiedField === 'link' ? '✓' : '📋'}
                    </button>
                  </div>
                </motion.div>
              </div>

              {/* Privacy reminder */}
              <motion.div 
                className="share-privacy"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
              >
                <span className="privacy-icon">🔒</span>
                <span>Only {data.recipient.split('@')[0] || data.recipient} can claim</span>
              </motion.div>

              {/* Done button */}
              <motion.button
                className="share-done-btn"
                onClick={onClose}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                whileTap={{ scale: 0.98 }}
              >
                Done
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ShareSheet;
