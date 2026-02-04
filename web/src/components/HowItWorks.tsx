import { useState, type FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './HowItWorks.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface Step {
  icon: string;
  title: string;
  description: string;
  detail?: string;
}

const steps: Step[] = [
  {
    icon: '💸',
    title: 'You send',
    description: 'Enter an amount and who it\'s for. Your tokens go into a shared pool.',
    detail: 'The pool mixes funds from many senders, making it impossible to trace.',
  },
  {
    icon: '🔑',
    title: 'Share the password',
    description: 'Send the password privately (Signal, DM, text) — it unlocks the funds.',
    detail: 'Only someone with this password can claim. Keep it secret!',
  },
  {
    icon: '🔐',
    title: 'They prove',
    description: 'The recipient proves they know the password — without revealing it.',
    detail: 'This "zero-knowledge proof" is the magic. The blockchain never sees the password.',
  },
  {
    icon: '✨',
    title: 'They claim',
    description: 'Funds transfer directly to their wallet. No trace links sender to receiver.',
    detail: 'Even we can\'t tell who sent what to whom. That\'s the point.',
  },
];

const securityFeatures = [
  { icon: '🛡️', label: 'Post-quantum secure', detail: 'STARK proofs, ready for future quantum computers' },
  { icon: '🧮', label: 'Browser-only proofs', detail: 'Your secrets never leave your device' },
  { icon: '🔒', label: 'Non-custodial', detail: 'Only you control your funds' },
];

// Stagger animation for list items
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -12, scale: 0.98 },
  visible: { 
    opacity: 1, 
    x: 0, 
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
  },
};

export const HowItWorks: FC<Props> = ({ isOpen, onClose }) => {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const toggleStep = (index: number) => {
    setExpandedStep(expandedStep === index ? null : index);
  };

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
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          >
            <div className="hiw-handle" onClick={onClose} aria-label="Close" role="button" tabIndex={0} />
            
            <div className="hiw-content">
              {/* Header */}
              <motion.div 
                className="hiw-header"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <motion.span 
                  className="hiw-emoji"
                  animate={{ 
                    rotate: [0, -5, 5, -5, 0],
                    scale: [1, 1.05, 1],
                  }}
                  transition={{ 
                    duration: 0.6, 
                    delay: 0.3,
                    ease: 'easeInOut',
                  }}
                >
                  🐈‍⬛
                </motion.span>
                <h2>How Murkl works</h2>
                <p>Private transfers in 4 simple steps</p>
              </motion.div>

              {/* Steps with numbering */}
              <motion.div 
                className="hiw-steps"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                {steps.map((step, index) => {
                  const isExpanded = expandedStep === index;
                  
                  return (
                    <motion.div 
                      key={step.title}
                      className={`hiw-step ${isExpanded ? 'expanded' : ''}`}
                      variants={itemVariants}
                      onClick={() => step.detail && toggleStep(index)}
                      role={step.detail ? 'button' : undefined}
                      tabIndex={step.detail ? 0 : undefined}
                      aria-expanded={step.detail ? isExpanded : undefined}
                    >
                      {/* Step number and icon column */}
                      <div className="hiw-step-left">
                        <div className="hiw-step-number">
                          <span>{index + 1}</span>
                        </div>
                        <div className="hiw-step-icon">
                          <span>{step.icon}</span>
                        </div>
                        {/* Connector line */}
                        {index < steps.length - 1 && (
                          <div className="hiw-step-line" />
                        )}
                      </div>
                      
                      {/* Content */}
                      <div className="hiw-step-content">
                        <div className="hiw-step-main">
                          <h3>{step.title}</h3>
                          <p>{step.description}</p>
                        </div>
                        
                        {/* Expandable detail */}
                        <AnimatePresence>
                          {isExpanded && step.detail && (
                            <motion.div
                              className="hiw-step-detail"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: 'easeOut' }}
                            >
                              <p>{step.detail}</p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        
                        {/* "Learn more" hint */}
                        {step.detail && !isExpanded && (
                          <span className="hiw-step-hint">Tap to learn more</span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>

              {/* Security features section */}
              <motion.div 
                className="hiw-security"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <h4>Built for privacy</h4>
                <div className="hiw-security-grid">
                  {securityFeatures.map((feature, index) => (
                    <motion.div 
                      key={feature.label}
                      className="hiw-security-item"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.6 + index * 0.08 }}
                      whileHover={{ scale: 1.02 }}
                    >
                      <span className="security-icon">{feature.icon}</span>
                      <div className="security-text">
                        <span className="security-label">{feature.label}</span>
                        <span className="security-detail">{feature.detail}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              {/* Close button */}
              <motion.button 
                className="hiw-close-btn" 
                onClick={onClose}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 }}
                whileTap={{ scale: 0.98 }}
              >
                Got it, let's go!
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default HowItWorks;
