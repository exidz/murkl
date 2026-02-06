import { memo, type FC } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import './TxStatusOverlay.css';

export type TxStage =
  | 'idle'
  | 'approve'
  | 'sending'
  | 'confirming'
  | 'verifying';

interface Props {
  open: boolean;
  stage: TxStage;
  onClose?: () => void;
}

const STAGE_COPY: Record<Exclude<TxStage, 'idle'>, { title: string; body: string; step: number }> = {
  approve: {
    title: 'Approve in your wallet',
    body: 'This is just a quick confirmation. You’re still in control.',
    step: 1,
  },
  sending: {
    title: 'Sending…',
    body: 'We’re broadcasting your payment to Solana.',
    step: 2,
  },
  confirming: {
    title: 'Almost there…',
    body: 'Waiting for the network to confirm.',
    step: 3,
  },
  verifying: {
    title: 'Final check…',
    body: 'Making sure everything landed safely.',
    step: 3,
  },
};

export const TxStatusOverlay: FC<Props> = memo(({ open, stage, onClose }) => {
  const reducedMotion = useReducedMotion();

  const isIdle = stage === 'idle';
  const copy = !isIdle ? STAGE_COPY[stage] : null;
  const progress = copy ? copy.step / 3 : 0;

  return (
    <AnimatePresence>
      {open && !isIdle && copy && (
        <motion.div
          className="tx-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Sending status"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => onClose?.()}
        >
          <motion.div
            className="tx-overlay-card"
            initial={{ y: 14, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 14, opacity: 0, scale: 0.98 }}
            transition={
              reducedMotion
                ? { duration: 0.1 }
                : { type: 'spring', stiffness: 500, damping: 40 }
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tx-overlay-header">
              <div className="tx-spinner" aria-hidden="true" />
              <div>
                <h3 className="tx-title">{copy.title}</h3>
                <p className="tx-body">{copy.body}</p>
              </div>
            </div>

            <div className="tx-progress" aria-hidden="true">
              <div className="tx-progress-track">
                <motion.div
                  className="tx-progress-fill"
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
              <div className="tx-progress-steps">
                <span className={copy.step >= 1 ? 'on' : ''}>Approve</span>
                <span className={copy.step >= 2 ? 'on' : ''}>Send</span>
                <span className={copy.step >= 3 ? 'on' : ''}>Confirm</span>
              </div>
            </div>

            <p className="tx-hint">Don’t close this page until it finishes.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

TxStatusOverlay.displayName = 'TxStatusOverlay';

export default TxStatusOverlay;
