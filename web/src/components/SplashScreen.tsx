import { memo, type FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './SplashScreen.css';

interface Props {
  /** Whether to show the splash screen */
  visible: boolean;
}

/**
 * Branded splash screen shown during WASM initialization.
 * 
 * Venmo-style: clean, centered, minimal.
 * Transitions smoothly into the main app when WASM is ready.
 * 
 * Features:
 * - Animated logo entrance
 * - Subtle pulsing load indicator
 * - Smooth fade-out transition
 * - Respects reduced motion
 */
export const SplashScreen: FC<Props> = memo(({ visible }) => {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="splash-screen"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
          role="status"
          aria-label="Loading Murkl"
        >
          {/* Background ambient glow */}
          <div className="splash-glow" aria-hidden="true" />

          {/* Main content */}
          <div className="splash-content">
            {/* Logo animation */}
            <motion.div
              className="splash-logo"
              initial={{ scale: 0.6, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ 
                type: 'spring', 
                stiffness: 260, 
                damping: 20,
                delay: 0.1,
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

            {/* Loading hint */}
            <motion.p
              className="splash-hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              transition={{ delay: 0.7, duration: 0.3 }}
            >
              Initializing prover…
            </motion.p>
          </div>

          {/* Trust chips at bottom */}
          <motion.div 
            className="splash-badges"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.4 }}
          >
            <span className="splash-badge">🔒 Zero Knowledge</span>
            <span className="splash-badge-dot" aria-hidden="true">•</span>
            <span className="splash-badge">🛡️ Post-quantum</span>
            <span className="splash-badge-dot" aria-hidden="true">•</span>
            <span className="splash-badge">⚡ Solana</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

SplashScreen.displayName = 'SplashScreen';

export default SplashScreen;
