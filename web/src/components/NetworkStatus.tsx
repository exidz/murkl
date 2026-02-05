import { useState, useEffect, useCallback, type FC } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import './NetworkStatus.css';

interface Props {
  /** Offset from top (for header clearance) */
  topOffset?: number;
}

/**
 * Venmo-style network status banner.
 *
 * For a financial app, attempting transactions while offline is dangerous.
 * This component:
 * - Detects online/offline state changes
 * - Shows a persistent warning banner when offline
 * - Shows a brief "Back online" confirmation when reconnecting
 * - Accessible with proper ARIA live regions
 * - Smooth animations respecting reduced motion
 *
 * Design: unobtrusive amber bar that slides down from the top.
 * Doesn't block interaction, but clearly communicates connectivity.
 */
export const NetworkStatus: FC<Props> = ({ topOffset = 0 }) => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [showReconnected, setShowReconnected] = useState(false);
  const [wasEverOffline, setWasEverOffline] = useState(false);
  const reducedMotion = useReducedMotion();

  const handleOnline = useCallback(() => {
    setIsOnline(true);
    // Only show "Back online" if we were previously offline
    if (wasEverOffline) {
      setShowReconnected(true);
      // Auto-dismiss after 3 seconds
      setTimeout(() => setShowReconnected(false), 3000);
    }
  }, [wasEverOffline]);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    setWasEverOffline(true);
    setShowReconnected(false);
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  const shouldShow = !isOnline || showReconnected;

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          className={`network-status ${!isOnline ? 'offline' : 'reconnected'}`}
          role="status"
          aria-live="assertive"
          aria-atomic="true"
          style={{ top: topOffset }}
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -40 }}
          animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -40 }}
          transition={
            reducedMotion
              ? { duration: 0.1 }
              : { type: 'spring', stiffness: 500, damping: 30 }
          }
        >
          <div className="network-status-content">
            {!isOnline ? (
              <>
                <span className="network-status-icon offline-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M1 1L15 15M3.5 6.5C4.87 5.43 6.36 4.72 8 4.5M12.5 6.5C11.8 5.95 11 5.52 10.15 5.22M5.5 9.5C6.2 8.9 7.06 8.5 8 8.5M10.5 9.5C10.17 9.24 9.8 9.04 9.4 8.9M8 12.5L8 12.51"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="network-status-text">
                  You're offline — transactions can't be sent right now
                </span>
                {!reducedMotion && (
                  <span className="network-status-pulse" aria-hidden="true" />
                )}
              </>
            ) : (
              <>
                <span className="network-status-icon online-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M4 8.5L7 11.5L12 5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="network-status-text">Back online</span>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NetworkStatus;
