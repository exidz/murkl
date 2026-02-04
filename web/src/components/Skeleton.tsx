import { memo, type FC, type CSSProperties } from 'react';
import { motion, type Variants } from 'framer-motion';
import './Skeleton.css';

interface SkeletonProps {
  /** Width - can be number (px) or string (e.g., "100%") */
  width?: number | string;
  /** Height - can be number (px) or string */
  height?: number | string;
  /** Border radius - number (px) or string */
  radius?: number | string;
  /** Make it a circle (sets radius to 50%) */
  circle?: boolean;
  /** Custom className */
  className?: string;
  /** Animate entrance with stagger (use with SkeletonList) */
  animate?: boolean;
  /** Custom animation delay for stagger effect */
  delay?: number;
}

// Animation variants for individual skeleton items
const skeletonVariants: Variants = {
  hidden: { 
    opacity: 0, 
    scale: 0.95,
  },
  visible: (delay: number) => ({
    opacity: 1,
    scale: 1,
    transition: {
      delay,
      duration: 0.3,
      ease: [0.25, 0.1, 0.25, 1],
    },
  }),
};

/**
 * Skeleton loading placeholder with Venmo-style shimmer animation.
 * Use to show content shape while data loads.
 */
export const Skeleton: FC<SkeletonProps> = memo(({
  width,
  height = 16,
  radius = 8,
  circle = false,
  className = '',
  animate = false,
  delay = 0,
}) => {
  const style: CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius: circle ? '50%' : typeof radius === 'number' ? `${radius}px` : radius,
  };

  // For circles, make height match width if width provided
  if (circle && width && !height) {
    style.height = style.width;
  }

  if (animate) {
    return (
      <motion.div 
        className={`skeleton ${className}`} 
        style={style}
        aria-hidden="true"
        variants={skeletonVariants}
        initial="hidden"
        animate="visible"
        custom={delay}
      />
    );
  }

  return (
    <div 
      className={`skeleton ${className}`} 
      style={style}
      aria-hidden="true"
    />
  );
});

Skeleton.displayName = 'Skeleton';

interface SkeletonTextProps {
  /** Number of lines to show */
  lines?: number;
  /** Gap between lines in px */
  gap?: number;
  /** Width of last line (e.g., "60%") */
  lastLineWidth?: string;
  /** Custom className */
  className?: string;
}

/**
 * Skeleton text block - shows multiple lines like a paragraph.
 */
export const SkeletonText: FC<SkeletonTextProps> = memo(({
  lines = 3,
  gap = 8,
  lastLineWidth = '70%',
  className = '',
}) => {
  return (
    <div className={`skeleton-text ${className}`} style={{ gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton 
          key={i} 
          width={i === lines - 1 ? lastLineWidth : '100%'} 
          height={14}
          radius={4}
        />
      ))}
    </div>
  );
});

SkeletonText.displayName = 'SkeletonText';

interface SkeletonCardProps {
  /** Show icon placeholder */
  icon?: boolean;
  /** Show title and subtitle */
  title?: boolean;
  /** Show action button */
  action?: boolean;
  /** Custom className */
  className?: string;
  /** Animation delay for stagger effect */
  delay?: number;
}

// Card animation variants
const cardVariants: Variants = {
  hidden: { 
    opacity: 0, 
    y: 12,
    scale: 0.98,
  },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay,
      duration: 0.35,
      ease: [0.25, 0.1, 0.25, 1],
    },
  }),
};

/**
 * Skeleton card - matches deposit card layout.
 * Use while loading deposits list.
 */
export const SkeletonCard: FC<SkeletonCardProps> = memo(({
  icon = true,
  title = true,
  action = true,
  className = '',
  delay = 0,
}) => {
  return (
    <motion.div 
      className={`skeleton-card ${className}`}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      custom={delay}
    >
      {icon && (
        <Skeleton width={48} height={48} circle />
      )}
      {title && (
        <div className="skeleton-card-content">
          <Skeleton width={80} height={18} />
          <Skeleton width={60} height={12} />
        </div>
      )}
      {action && (
        <Skeleton width={72} height={36} radius={8} />
      )}
    </motion.div>
  );
});

SkeletonCard.displayName = 'SkeletonCard';

interface SkeletonListProps {
  /** Number of items to show */
  count?: number;
  /** Delay between items in seconds */
  staggerDelay?: number;
  /** Type of skeleton items */
  variant?: 'card' | 'text' | 'custom';
  /** Custom render function for each item */
  renderItem?: (index: number, delay: number) => React.ReactNode;
  /** Custom className for the list container */
  className?: string;
  /** Gap between items in pixels */
  gap?: number;
}

// List container variants for stagger animation
const listContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.05,
    },
  },
};

/**
 * Skeleton list with stagger animation.
 * Perfect for loading states in lists of deposits, transactions, etc.
 * 
 * Features:
 * - Staggered entrance animation
 * - Multiple variants (card, text, custom)
 * - Smooth perceived loading experience
 */
export const SkeletonList: FC<SkeletonListProps> = memo(({
  count = 3,
  staggerDelay = 0.08,
  variant = 'card',
  renderItem,
  className = '',
  gap = 12,
}) => {
  return (
    <motion.div
      className={`skeleton-list ${className}`}
      style={{ gap }}
      variants={listContainerVariants}
      initial="hidden"
      animate="visible"
      aria-busy="true"
      aria-label="Loading content"
    >
      {Array.from({ length: count }).map((_, index) => {
        const delay = index * staggerDelay;
        
        if (renderItem) {
          return (
            <motion.div
              key={index}
              variants={cardVariants}
              custom={0}
            >
              {renderItem(index, delay)}
            </motion.div>
          );
        }
        
        if (variant === 'text') {
          return (
            <motion.div
              key={index}
              variants={cardVariants}
              custom={0}
            >
              <SkeletonText lines={2} />
            </motion.div>
          );
        }
        
        // Default: card variant (without passing delay since parent handles stagger)
        return (
          <motion.div
            key={index}
            className="skeleton-card"
            variants={cardVariants}
            custom={0}
          >
            <Skeleton width={48} height={48} circle />
            <div className="skeleton-card-content">
              <Skeleton width={80} height={18} />
              <Skeleton width={60} height={12} />
            </div>
            <Skeleton width={72} height={36} radius={8} />
          </motion.div>
        );
      })}
    </motion.div>
  );
});

SkeletonList.displayName = 'SkeletonList';

interface SkeletonAmountProps {
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show currency symbol placeholder */
  showCurrency?: boolean;
  /** Animation delay */
  delay?: number;
  /** Custom className */
  className?: string;
}

/**
 * Skeleton for amount displays (Venmo-style big numbers).
 * Matches the AmountInput component visual style.
 */
export const SkeletonAmount: FC<SkeletonAmountProps> = memo(({
  size = 'lg',
  showCurrency = true,
  delay = 0,
  className = '',
}) => {
  const sizeConfig = {
    sm: { amount: 32, currency: 20, gap: 6 },
    md: { amount: 48, currency: 28, gap: 8 },
    lg: { amount: 64, currency: 36, gap: 10 },
  };
  
  const config = sizeConfig[size];
  
  return (
    <motion.div 
      className={`skeleton-amount ${className}`}
      style={{ gap: config.gap }}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.3 }}
    >
      {showCurrency && (
        <Skeleton 
          width={config.currency} 
          height={config.currency} 
          circle 
        />
      )}
      <Skeleton 
        width={size === 'lg' ? 140 : size === 'md' ? 100 : 70} 
        height={config.amount} 
        radius={8} 
      />
    </motion.div>
  );
});

SkeletonAmount.displayName = 'SkeletonAmount';

export default Skeleton;
