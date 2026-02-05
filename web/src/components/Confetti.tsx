import { useEffect, useState, useMemo, useRef, type FC } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import './Confetti.css';

interface ConfettiPiece {
  id: number;
  x: number;
  delay: number;
  duration: number;
  rotation: number;
  color: string;
  size: number;
  type: 'square' | 'circle' | 'strip' | 'star';
  wobble: number;
  drift: number;
}

interface Props {
  /** Number of confetti pieces */
  count?: number;
  /** Whether to show confetti */
  active?: boolean;
  /** Duration in ms before auto-hide */
  duration?: number;
  /** Trigger haptic feedback on celebration */
  haptic?: boolean;
}

// Venmo-inspired celebration palette - rich, premium colors
const COLORS = [
  '#22c55e', // success green
  '#3d95ce', // Murkl blue
  '#f59e0b', // warm orange
  '#a855f7', // vibrant purple
  '#ec4899', // playful pink
  '#14F195', // Solana mint
  '#fbbf24', // gold
  '#38bdf8', // sky blue
];

// Trigger haptic feedback on supported devices
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
 * Venmo-style celebration confetti effect.
 *
 * Features:
 * - Multiple particle shapes (square, circle, strip, star)
 * - Natural physics with wobble and drift
 * - Haptic feedback on mobile
 * - Premium color palette
 * - Respects reduced motion preference
 * - Performance-optimized with memoization
 */
export const Confetti: FC<Props> = ({
  count = 50,
  active = true,
  duration = 3500,
  haptic = true,
}) => {
  const [visible, setVisible] = useState(active);
  const hasTriggeredRef = useRef(false);
  const reducedMotion = useReducedMotion();

  // Auto-hide after duration
  useEffect(() => {
    if (!active) {
      setVisible(false);
      hasTriggeredRef.current = false;
      return;
    }

    setVisible(true);

    // Haptic celebration pattern (only once per activation)
    if (haptic && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;
      // Celebration burst pattern: quick-quick-long
      triggerHaptic([15, 30, 15, 30, 50]);
    }

    const timer = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timer);
  }, [active, duration, haptic]);

  // Generate confetti pieces with physics properties
  const pieces = useMemo<ConfettiPiece[]>(() => {
    // Reduced count for reduced motion
    const actualCount = reducedMotion ? Math.floor(count / 3) : count;

    return Array.from({ length: actualCount }, (_, i) => ({
      id: i,
      x: 5 + Math.random() * 90, // Keep 5% margins
      delay: Math.random() * 0.6, // Stagger start
      duration: reducedMotion ? 1 : 2.5 + Math.random() * 1.5, // Fall duration
      rotation: Math.random() * 720 - 360, // Spin amount
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 6 + Math.random() * 7, // 6-13px
      type: (['square', 'circle', 'strip', 'star'] as const)[Math.floor(Math.random() * 4)],
      wobble: 15 + Math.random() * 25, // Horizontal wobble amplitude
      drift: (Math.random() - 0.5) * 50, // Horizontal drift as it falls
    }));
  }, [count, reducedMotion]);

  // Skip rendering entirely if reduced motion and not active
  if (!visible) return null;
  if (reducedMotion && !active) return null;

  return (
    <div className="confetti-container" aria-hidden="true">
      {pieces.map(piece => (
        <motion.div
          key={piece.id}
          className={`confetti-piece confetti-${piece.type}`}
          style={{
            left: `${piece.x}%`,
            backgroundColor: piece.type === 'star' ? 'transparent' : piece.color,
            borderColor: piece.type === 'star' ? piece.color : undefined,
            width: piece.type === 'strip' ? piece.size * 0.35 : piece.size,
            height: piece.type === 'strip' ? piece.size * 2.5 : piece.size,
            boxShadow: `0 0 ${piece.size * 0.5}px ${piece.color}40`,
          }}
          initial={{
            y: -20,
            x: 0,
            opacity: 1,
            rotate: 0,
            scale: 0,
          }}
          animate={{
            y: '110vh',
            x: reducedMotion ? 0 : [0, piece.wobble, -piece.wobble * 0.7, piece.drift],
            opacity: [1, 1, 1, 0],
            rotate: reducedMotion ? 0 : piece.rotation,
            scale: [0, 1.2, 1, 0.3],
          }}
          transition={{
            duration: piece.duration,
            delay: piece.delay,
            ease: [0.25, 0.46, 0.45, 0.94],
            x: {
              duration: piece.duration,
              ease: 'easeInOut',
              times: [0, 0.3, 0.6, 1],
            },
          }}
        />
      ))}
    </div>
  );
};

export default Confetti;
