import { memo, type FC, type CSSProperties } from 'react';
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
}

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
}

/**
 * Skeleton card - matches deposit card layout.
 * Use while loading deposits list.
 */
export const SkeletonCard: FC<SkeletonCardProps> = memo(({
  icon = true,
  title = true,
  action = true,
  className = '',
}) => {
  return (
    <div className={`skeleton-card ${className}`}>
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
    </div>
  );
});

SkeletonCard.displayName = 'SkeletonCard';

export default Skeleton;
