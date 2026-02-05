import { memo, useState, useEffect, type FC } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import './SplashScreen.css';

interface Props {
  /** Whether to show the splash screen */
  visible: boolean;
}

// Friendly loading tips — rotate through these while WASM loads.
// Educates users about Murkl's privacy features during the wait.
const LOADING_TIPS = [
  { text: 'Initializing prover…', icon: '🔐' },
  { text: 'Your secrets never leave your browser', icon: '💻' },
  { text: 'STARK proofs in milliseconds', icon: '⚡' },
  { text: 'Post-quantum cryptography built in', icon: '🛡️' },
  { text: 'No one can trace sender to receiver', icon: '👻' },
  { text: 'Privacy is a feature, not an afterthought', icon: '🔒' },
];

// Floating particle data — static so we don't recreate on each render
const PARTICLES = Array.from({ length: 6 }, (_, i) => ({
  id: i,
  x: 30 + Math.random() * 40, // keep in middle 40% of screen
  y: 20 + Math.random() * 60,
  size: 2 + Math.random() * 3,
  delay: Math.random() * 2,
  duration: 3 + Math.random() * 4,
}));

/**
 * Branded splash screen shown during WASM initialization.
 *
 * Venmo-style: clean, centered, minimal — but memorable.
 * Transitions smoothly into the main app when WASM is ready.
 *
 * Features:
 * - Animated logo with idle float/breathing
 * - Cycling loading tips that educate about privacy
 * - Floating ambient particles in the background
 * - Dramatic exit: blur + scale zoom-through
 * - Staggered trust badge entrance
 * - Respects reduced motion
 */
export const SplashScreen: FC<Props> = memo(({ visible }) => {
  const [tipIndex, setTipIndex] = useState(0);
  const reducedMotion = useReducedMotion();

  // Cycle through loading tips every 2.5 seconds
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      setTipIndex(prev => (prev + 1) % LOADING_TIPS.length);
    }, 2500);
    return () => clearInterval(timer);
  }, [visible]);

  const currentTip = LOADING_TIPS[tipIndex];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="splash-screen"
          initial={{ opacity: 1 }}
          exit={{
            opacity: 0,
            scale: 1.08,
            filter: reducedMotion ? 'none' : 'blur(8px)',
          }}
          transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
          role="status"
          aria-label="Loading Murkl"
        >
          {/* Background ambient glow */}
          <div className="splash-glow" aria-hidden="true" />

          {/* Floating ambient particles — subtle depth effect */}
          {!reducedMotion && (
            <div className="splash-particles" aria-hidden="true">
              {PARTICLES.map(p => (
                <motion.div
                  key={p.id}
                  className="splash-particle"
                  style={{
                    left: `${p.x}%`,
                    top: `${p.y}%`,
                    width: p.size,
                    height: p.size,
                  }}
                  animate={{
                    y: [0, -20, 0],
                    opacity: [0.15, 0.4, 0.15],
                  }}
                  transition={{
                    duration: p.duration,
                    delay: p.delay,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />
              ))}
            </div>
          )}

          {/* Main content */}
          <div className="splash-content">
            {/* Logo animation with idle float */}
            <motion.div
              className="splash-logo"
              initial={{ scale: 0.6, opacity: 0, y: 10 }}
              animate={{
                scale: 1,
                opacity: 1,
                y: reducedMotion ? 0 : [0, -6, 0],
              }}
              transition={{
                scale: { type: 'spring', stiffness: 260, damping: 20, delay: 0.1 },
                opacity: { duration: 0.3, delay: 0.1 },
                y: reducedMotion
                  ? { duration: 0.3, delay: 0.1 }
                  : { duration: 3, delay: 0.8, repeat: Infinity, ease: 'easeInOut' },
              }}
            >
              🐈‍⬛
            </motion.div>

            {/* Brand name */}
            <motion.h1
              className="splash-title"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.3 }}
            >
              Murkl
            </motion.h1>

            {/* Tagline */}
            <motion.p
              className="splash-tagline"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35, duration: 0.3 }}
            >
              Private payments on Solana
            </motion.p>

            {/* Loading indicator */}
            <motion.div
              className="splash-loader"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 120 }}
              transition={{ delay: 0.5, duration: 0.3 }}
            >
              <div className="splash-loader-track">
                <div className="splash-loader-fill" />
              </div>
            </motion.div>

            {/* Cycling loading tips — crossfade between messages */}
            <div className="splash-tip-container">
              <AnimatePresence mode="wait">
                <motion.p
                  key={tipIndex}
                  className="splash-hint"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 0.65, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                >
                  <span className="splash-hint-icon" aria-hidden="true">
                    {currentTip.icon}
                  </span>
                  {currentTip.text}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>

          {/* Trust chips at bottom — stagger in individually */}
          <div className="splash-badges">
            {[
              { icon: '🔒', label: 'Zero Knowledge' },
              { icon: '🛡️', label: 'Post-quantum' },
              { icon: '⚡', label: 'Solana' },
            ].map((badge, i) => (
              <motion.span
                key={badge.label}
                className="splash-badge"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.8 + i * 0.1,
                  duration: 0.3,
                  ease: 'easeOut',
                }}
              >
                {badge.icon} {badge.label}
              </motion.span>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

SplashScreen.displayName = 'SplashScreen';

export default SplashScreen;
