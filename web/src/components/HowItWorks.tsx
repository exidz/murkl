import { type FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './HowItWorks.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const steps = [
  {
    icon: '💸',
    title: 'You send',
    description: 'Enter an amount and who it\'s for. Your tokens go into a shared pool.',
  },
  {
    icon: '🔑',
    title: 'Share secretly',
    description: 'Send the password to your recipient privately (text, Signal, etc).',
  },
  {
    icon: '🔐',
    title: 'They prove',
    description: 'The recipient proves they know the password — without revealing it.',
  },
  {
    icon: '✨',
    title: 'They claim',
    description: 'Funds transfer directly to their wallet. No one can trace sender to receiver.',
  },
];

export const HowItWorks: FC<Props> = ({ isOpen, onClose }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            className="hiw-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div 
            className="hiw-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            <div className="hiw-handle" onClick={onClose} />
            
            <div className="hiw-content">
              <div className="hiw-header">
                <span className="hiw-emoji">🐈‍⬛</span>
                <h2>How Murkl works</h2>
                <p>Private transfers in 4 steps</p>
              </div>

              <div className="hiw-steps">
                {steps.map((step, index) => (
                  <motion.div 
                    key={step.title}
                    className="hiw-step"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <div className="hiw-step-icon">
                      <span>{step.icon}</span>
                      {index < steps.length - 1 && <div className="hiw-step-line" />}
                    </div>
                    <div className="hiw-step-content">
                      <h3>{step.title}</h3>
                      <p>{step.description}</p>
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="hiw-footer">
                <div className="hiw-badge">
                  <span>🛡️</span>
                  <span>Post-quantum secure</span>
                </div>
                <div className="hiw-badge">
                  <span>🧮</span>
                  <span>Proof generated in-browser</span>
                </div>
              </div>

              <button className="hiw-close-btn" onClick={onClose}>
                Got it
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default HowItWorks;
