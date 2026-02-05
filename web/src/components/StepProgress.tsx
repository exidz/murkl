import { memo, type FC } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import './StepProgress.css';

interface Step {
  id: string;
  label: string;
}

interface Props {
  /** Step definitions */
  steps: Step[];
  /** Currently active step id */
  activeStep: string;
  /** Optional: additional CSS class */
  className?: string;
}

/**
 * Venmo-style step progress indicator for multi-step flows.
 *
 * Design principles (from DESIGN.md):
 * - Minimal, non-distracting — the amount input is the hero
 * - Provides orientation without stealing focus
 * - Smooth animated transitions between steps
 * - Mobile-first, touch-friendly
 * - Accessible with proper ARIA roles
 *
 * Visual: connected dots with animated fill line
 *
 *   ● ──── ● ──── ○ ──── ○
 *  Amount  To   Password Review
 */
export const StepProgress: FC<Props> = memo(({ steps, activeStep, className = '' }) => {
  const reducedMotion = useReducedMotion();
  const activeIndex = steps.findIndex(s => s.id === activeStep);

  // Progress percentage (0 to 1)
  const progress = activeIndex / Math.max(steps.length - 1, 1);

  return (
    <div
      className={`step-progress ${className}`}
      role="navigation"
      aria-label="Send progress"
    >
      {/* Connecting track (behind dots) */}
      <div className="step-track" aria-hidden="true">
        <motion.div
          className="step-track-fill"
          initial={false}
          animate={{ scaleX: progress }}
          transition={
            reducedMotion
              ? { duration: 0.1 }
              : { type: 'spring', stiffness: 300, damping: 30 }
          }
          style={{ transformOrigin: 'left' }}
        />
      </div>

      {/* Step dots + labels */}
      <ol className="step-dots" aria-label="Steps">
        {steps.map((step, index) => {
          const isComplete = index < activeIndex;
          const isActive = index === activeIndex;
          const isPending = index > activeIndex;

          return (
            <li
              key={step.id}
              className={[
                'step-dot-group',
                isComplete && 'complete',
                isActive && 'active',
                isPending && 'pending',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-current={isActive ? 'step' : undefined}
            >
              <motion.div
                className="step-dot"
                initial={false}
                animate={
                  isActive
                    ? {
                        scale: reducedMotion ? 1 : [1, 1.2, 1],
                        boxShadow: reducedMotion
                          ? 'none'
                          : [
                              '0 0 0 0 rgba(61, 149, 206, 0)',
                              '0 0 0 6px rgba(61, 149, 206, 0.2)',
                              '0 0 0 0 rgba(61, 149, 206, 0)',
                            ],
                      }
                    : { scale: 1, boxShadow: '0 0 0 0 rgba(61, 149, 206, 0)' }
                }
                transition={
                  isActive && !reducedMotion
                    ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
                    : { duration: 0.2 }
                }
              >
                {/* Checkmark for completed steps */}
                {isComplete && (
                  <motion.svg
                    viewBox="0 0 12 12"
                    fill="none"
                    className="step-check-icon"
                    initial={reducedMotion ? {} : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={
                      reducedMotion
                        ? { duration: 0.1 }
                        : { type: 'spring', stiffness: 400, damping: 15 }
                    }
                    aria-hidden="true"
                  >
                    <path
                      d="M2.5 6.5L5 9L9.5 3.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </motion.svg>
                )}
              </motion.div>

              {/* Label (visible on larger screens, all steps; on mobile, active only) */}
              <span className="step-dot-label">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
});

StepProgress.displayName = 'StepProgress';

export default StepProgress;
