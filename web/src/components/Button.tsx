import { 
  forwardRef, 
  useCallback, 
  useRef, 
  type ReactNode,
  type MouseEvent,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './Button.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  /** Button visual style */
  variant?: ButtonVariant;
  /** Button size */
  size?: ButtonSize;
  /** Show loading spinner and disable interactions */
  loading?: boolean;
  /** Loading text (shown next to spinner) */
  loadingText?: string;
  /** Icon to show before text */
  icon?: ReactNode;
  /** Icon to show after text */
  iconRight?: ReactNode;
  /** Button content */
  children: ReactNode;
  /** Full width button */
  fullWidth?: boolean;
  /** Enable haptic feedback on mobile */
  haptic?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Click handler */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Additional class names */
  className?: string;
  /** Button type */
  type?: 'button' | 'submit' | 'reset';
  /** Aria label */
  'aria-label'?: string;
}

// Trigger haptic feedback on supported devices
const triggerHaptic = (pattern: number | number[] = 10) => {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Silently fail if not supported
    }
  }
};

/**
 * Venmo-style button with loading states, haptic feedback, and micro-interactions.
 * 
 * Features:
 * - Smooth press animations (scale + shadow)
 * - Loading spinner that replaces content
 * - Haptic feedback on mobile (opt-in)
 * - Ripple effect on click
 * - Accessible focus states
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  icon,
  iconRight,
  children,
  fullWidth = false,
  haptic = true,
  disabled,
  onClick,
  className = '',
  type = 'button',
  'aria-label': ariaLabel,
}, ref) => {
  const rippleRef = useRef<HTMLSpanElement>(null);
  const isDisabled = disabled || loading;

  // Handle click with ripple effect and haptic feedback
  const handleClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    if (isDisabled) return;

    // Haptic feedback
    if (haptic) {
      triggerHaptic(variant === 'primary' ? [10, 5, 10] : 10);
    }

    // Ripple effect
    if (rippleRef.current) {
      const button = e.currentTarget;
      const rect = button.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const ripple = rippleRef.current;

      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      ripple.classList.remove('active');
      // Force reflow to restart animation
      void ripple.offsetWidth;
      ripple.classList.add('active');
      
      // Clean up after animation completes
      const cleanup = () => {
        ripple.classList.remove('active');
        ripple.removeEventListener('animationend', cleanup);
      };
      ripple.addEventListener('animationend', cleanup, { once: true });
    }

    onClick?.(e);
  }, [isDisabled, haptic, variant, onClick]);

  const buttonClasses = [
    'btn',
    `btn-${variant}`,
    `btn-${size}`,
    fullWidth && 'btn-full',
    loading && 'btn-loading',
    className,
  ].filter(Boolean).join(' ');

  return (
    <motion.button
      ref={ref}
      type={type}
      className={buttonClasses}
      disabled={isDisabled}
      onClick={handleClick}
      aria-label={ariaLabel}
      whileHover={!isDisabled ? { scale: 1.02, y: -1 } : undefined}
      whileTap={!isDisabled ? { scale: 0.98 } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {/* Ripple effect container */}
      <span className="btn-ripple" ref={rippleRef} aria-hidden="true" />

      {/* Content with AnimatePresence for smooth transitions */}
      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.span
            key="loading"
            className="btn-content"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
          >
            <span className="btn-spinner" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle 
                  cx="12" cy="12" r="10" 
                  stroke="currentColor" 
                  strokeWidth="3" 
                  strokeLinecap="round"
                  opacity="0.25"
                />
                <path 
                  d="M12 2a10 10 0 0 1 10 10" 
                  stroke="currentColor" 
                  strokeWidth="3" 
                  strokeLinecap="round"
                />
              </svg>
            </span>
            {loadingText && <span className="btn-text">{loadingText}</span>}
          </motion.span>
        ) : (
          <motion.span
            key="content"
            className="btn-content"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
          >
            {icon && <span className="btn-icon btn-icon-left" aria-hidden="true">{icon}</span>}
            <span className="btn-text">{children}</span>
            {iconRight && <span className="btn-icon btn-icon-right" aria-hidden="true">{iconRight}</span>}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Focus ring (for keyboard navigation) */}
      <span className="btn-focus-ring" aria-hidden="true" />
    </motion.button>
  );
});

Button.displayName = 'Button';

/**
 * Icon-only button variant
 */
interface IconButtonProps {
  /** The icon to display */
  icon: ReactNode;
  /** Accessible label (required for icon-only buttons) */
  'aria-label': string;
  /** Button visual style */
  variant?: ButtonVariant;
  /** Button size */
  size?: ButtonSize;
  /** Disabled state */
  disabled?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Click handler */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Additional class names */
  className?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(({
  icon,
  size = 'md',
  className = '',
  'aria-label': ariaLabel,
  ...props
}, ref) => {
  return (
    <Button
      ref={ref}
      size={size}
      className={`btn-icon-only ${className}`}
      aria-label={ariaLabel}
      {...props}
    >
      {icon}
    </Button>
  );
});

IconButton.displayName = 'IconButton';

export default Button;
