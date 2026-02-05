import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FC,
  type TouchEvent,
} from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { RecentSend } from '../hooks/useRecentSends';
import { RecentActivity } from './RecentActivity';
import './RecentSendsSheet.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  sends: RecentSend[];
  onClear?: () => void;
}

// Trigger haptic feedback on supported devices
const triggerHaptic = (pattern: number | number[] = 10) => {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // no-op
    }
  }
};

/**
 * Venmo-style bottom sheet for "Recent sends".
 *
 * DESIGN.md goals:
 * - One action per screen: keep the amount step focused
 * - Mobile-first: swipe down to dismiss, big tap targets
 */
export const RecentSendsSheet: FC<Props> = ({ isOpen, onClose, sends, onClear }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragY, setDragY] = useState(0);
  const touchStartRef = useRef<{ y: number; time: number } | null>(null);
  const reducedMotion = useReducedMotion();

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

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

    if (dragY > 150 || velocity > 0.5) {
      triggerHaptic(15);
      onClose();
    }

    touchStartRef.current = null;
    setIsDragging(false);
    setDragY(0);
  }, [dragY, isDragging, onClose]);

  const sheetStyle = isDragging
    ? {
        transform: `translateY(${dragY}px)`,
        transition: 'none',
      }
    : {};

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="recent-sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0.1 : 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.div
            className="recent-sheet"
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
            aria-labelledby="recent-sends-title"
          >
            <div className="recent-sheet-handle" onClick={onClose}>
              <div className="recent-sheet-handle-bar" />
            </div>

            <div className="recent-sheet-content">
              <header className="recent-sheet-header">
                <h2 id="recent-sends-title">Recent sends</h2>
                <p className="recent-sheet-subtitle">Quickly copy a claim link or open the transaction.</p>
              </header>

              <RecentActivity sends={sends} onClear={onClear} />

              <motion.button
                className="recent-sheet-done"
                onClick={onClose}
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

export default RecentSendsSheet;
