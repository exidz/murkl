import { useEffect, useState, useMemo, type FC } from 'react';
import { motion } from 'framer-motion';
import './Confetti.css';

interface ConfettiPiece {
  id: number;
  x: number;
  delay: number;
  duration: number;
  rotation: number;
  color: string;
  size: number;
  type: 'square' | 'circle' | 'strip';
}

interface Props {
  /** Number of confetti pieces */
  count?: number;
  /** Whether to show confetti */
  active?: boolean;
  /** Duration in ms before auto-hide */
  duration?: number;
}

const COLORS = [
  '#22c55e', // green (success)
  '#3d95ce', // blue (accent)
  '#f59e0b', // orange
  '#a855f7', // purple
  '#ec4899', // pink
  '#14F195', // Solana green
];

/**
 * Celebration confetti effect.
 * Renders animated pieces that fall from top.
 */
export const Confetti: FC<Props> = ({ 
  count = 50, 
  active = true,
  duration = 3000,
}) => {
  const [visible, setVisible] = useState(active);

  // Auto-hide after duration
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timer);
  }, [active, duration]);

  // Generate confetti pieces (memoized to prevent re-generation)
  const pieces = useMemo<ConfettiPiece[]>(() => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      x: Math.random() * 100, // % from left
      delay: Math.random() * 0.5, // stagger start
      duration: 2 + Math.random() * 1.5, // fall duration
      rotation: Math.random() * 720 - 360, // spin amount
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 6 + Math.random() * 6, // 6-12px
      type: (['square', 'circle', 'strip'] as const)[Math.floor(Math.random() * 3)],
    }));
  }, [count]);

  if (!visible) return null;

  return (
    <div className="confetti-container" aria-hidden="true">
      {pieces.map(piece => (
        <motion.div
          key={piece.id}
          className={`confetti-piece confetti-${piece.type}`}
          style={{
            left: `${piece.x}%`,
            backgroundColor: piece.color,
            width: piece.type === 'strip' ? piece.size * 0.4 : piece.size,
            height: piece.type === 'strip' ? piece.size * 2 : piece.size,
          }}
          initial={{ 
            y: -20, 
            opacity: 1,
            rotate: 0,
            scale: 0,
          }}
          animate={{ 
            y: '100vh',
            opacity: [1, 1, 0],
            rotate: piece.rotation,
            scale: [0, 1, 1, 0.5],
          }}
          transition={{
            duration: piece.duration,
            delay: piece.delay,
            ease: [0.25, 0.46, 0.45, 0.94],
          }}
        />
      ))}
    </div>
  );
};

export default Confetti;
