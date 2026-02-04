import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FC,
  type ReactNode,
  type TouchEvent,
} from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import './Toast.css';

export type ToastType = 'success' | 'error' | 'info' | 'loading';

export interface ToastData {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
  duration?: number;
  icon?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastItemProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

// Default icons per toast type
const defaultIcons: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  loading: '◌',
};

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

/**
 * Individual toast notification with Venmo-style animations.
 * Features:
 * - Swipe to dismiss
 * - Success celebration effect
 * - Error shake animation
 * - Auto-dismiss with progress indicator
 */
const ToastItem: FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const [progress, setProgress] = useState(100);
  const [isDragging, setIsDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const reducedMotion = useReducedMotion();

  const duration = toast.duration ?? (toast.type === 'loading' ? Infinity : 4000);
  const hasAutoClose = duration !== Infinity && toast.type !== 'loading';

  // Auto-dismiss timer with progress
  useEffect(() => {
    if (!hasAutoClose) return;

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        onDismiss(toast.id);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [toast.id, duration, hasAutoClose, onDismiss]);

  // Swipe-to-dismiss handlers
  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    };
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current) return;

    const deltaX = e.touches[0].clientX - touchStartRef.current.x;
    const deltaY = e.touches[0].clientY - touchStartRef.current.y;

    // Only swipe horizontally
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      setIsDragging(true);
      setDragX(deltaX);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current) return;

    const velocity = isDragging ? Math.abs(dragX) / (Date.now() - touchStartRef.current.time) : 0;

    // Dismiss if swiped far enough or fast enough
    if (Math.abs(dragX) > 100 || velocity > 0.5) {
      triggerHaptic(10);
      onDismiss(toast.id);
    }

    touchStartRef.current = null;
    setIsDragging(false);
    setDragX(0);
  }, [dragX, isDragging, onDismiss, toast.id]);

  const handleDismiss = useCallback(() => {
    triggerHaptic(8);
    onDismiss(toast.id);
  }, [onDismiss, toast.id]);

  // Animation variants
  const variants = {
    initial: {
      opacity: 0,
      y: 50,
      scale: 0.9,
    },
    animate: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: reducedMotion
        ? { duration: 0.1 }
        : {
            type: 'spring' as const,
            stiffness: 400,
            damping: 25,
          },
    },
    exit: {
      opacity: 0,
      y: 20,
      scale: 0.95,
      x: dragX > 50 ? 200 : dragX < -50 ? -200 : 0,
      transition: { duration: 0.2 },
    },
  };

  // Success celebration animation
  const successPulse = toast.type === 'success' && !reducedMotion;

  // Error shake animation
  const errorShake = toast.type === 'error' && !reducedMotion
    ? {
        x: [0, -8, 8, -6, 6, -4, 4, 0],
        transition: { duration: 0.5, delay: 0.1 },
      }
    : {};

  const icon = toast.icon || defaultIcons[toast.type];

  return (
    <motion.div
      className={`toast toast-${toast.type} ${isDragging ? 'dragging' : ''}`}
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{
        transform: isDragging ? `translateX(${dragX}px)` : undefined,
        opacity: isDragging ? 1 - Math.abs(dragX) / 200 : undefined,
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      role="alert"
      aria-live="polite"
    >
      {/* Icon with animation */}
      <motion.div
        className="toast-icon"
        animate={toast.type === 'error' ? errorShake : {}}
      >
        {toast.type === 'loading' ? (
          <motion.span
            className="toast-spinner"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          >
            {icon}
          </motion.span>
        ) : (
          <motion.span
            initial={successPulse ? { scale: 0 } : {}}
            animate={successPulse ? { scale: [0, 1.3, 1] } : {}}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            {icon}
          </motion.span>
        )}

        {/* Success celebration ring */}
        {successPulse && (
          <motion.div
            className="toast-ring"
            initial={{ scale: 0.8, opacity: 1 }}
            animate={{ scale: 2, opacity: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          />
        )}
      </motion.div>

      {/* Content */}
      <div className="toast-content">
        <p className="toast-message">{toast.message}</p>
        {toast.description && (
          <p className="toast-description">{toast.description}</p>
        )}
      </div>

      {/* Action button */}
      {toast.action && (
        <button
          className="toast-action"
          onClick={() => {
            toast.action?.onClick();
            handleDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}

      {/* Dismiss button */}
      {toast.type !== 'loading' && (
        <button
          className="toast-dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}

      {/* Progress bar */}
      {hasAutoClose && (
        <motion.div
          className="toast-progress"
          initial={{ scaleX: 1 }}
          style={{ scaleX: progress / 100, transformOrigin: 'left' }}
        />
      )}
    </motion.div>
  );
};

// Global toast state management
let toastId = 0;
const listeners: Set<(toasts: ToastData[]) => void> = new Set();
let toasts: ToastData[] = [];

const notify = (toastsUpdate: ToastData[]) => {
  toasts = toastsUpdate;
  listeners.forEach((listener) => listener(toasts));
};

/**
 * Toast API - use like:
 * toast.success('Payment sent!')
 * toast.error('Failed to process')
 * toast.info('New update available', { action: { label: 'Update', onClick: ... }})
 * toast.loading('Processing...')
 */
export const toast = {
  show: (type: ToastType, message: string, options?: Partial<Omit<ToastData, 'id' | 'type' | 'message'>>) => {
    const id = `toast-${++toastId}`;
    const newToast: ToastData = {
      id,
      type,
      message,
      ...options,
    };
    notify([...toasts, newToast]);
    
    // Haptic feedback
    if (type === 'success') triggerHaptic([10, 5, 15]);
    if (type === 'error') triggerHaptic([15, 10, 15, 10, 15]);
    
    return id;
  },
  
  success: (message: string, options?: Partial<Omit<ToastData, 'id' | 'type' | 'message'>>) =>
    toast.show('success', message, options),
    
  error: (message: string, options?: Partial<Omit<ToastData, 'id' | 'type' | 'message'>>) =>
    toast.show('error', message, options),
    
  info: (message: string, options?: Partial<Omit<ToastData, 'id' | 'type' | 'message'>>) =>
    toast.show('info', message, options),
    
  loading: (message: string, options?: Partial<Omit<ToastData, 'id' | 'type' | 'message'>>) =>
    toast.show('loading', message, { duration: Infinity, ...options }),
    
  dismiss: (id?: string) => {
    if (id) {
      notify(toasts.filter((t) => t.id !== id));
    } else {
      notify([]);
    }
  },
  
  // Update existing toast (useful for loading -> success flow)
  update: (id: string, updates: Partial<Omit<ToastData, 'id'>>) => {
    notify(
      toasts.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      )
    );
  },
};

/**
 * Venmo-style toast container.
 * Place at app root, renders toasts at bottom-center.
 */
export const ToastContainer: FC = () => {
  const [currentToasts, setCurrentToasts] = useState<ToastData[]>([]);

  useEffect(() => {
    listeners.add(setCurrentToasts);
    return () => {
      listeners.delete(setCurrentToasts);
    };
  }, []);

  const handleDismiss = useCallback((id: string) => {
    toast.dismiss(id);
  }, []);

  return (
    <div className="toast-container" aria-live="polite" aria-label="Notifications">
      <AnimatePresence mode="sync">
        {currentToasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={handleDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default toast;
