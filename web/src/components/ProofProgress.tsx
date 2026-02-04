import { useState, useEffect, type FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './ProofProgress.css';

interface Props {
  stage: 'generating' | 'uploading' | 'verifying' | 'claiming' | 'complete';
  progress?: number; // 0-100 for generating stage
  onComplete?: () => void;
}

// Stage configuration with friendlier copy
const stages = [
  { id: 'generating', label: 'Proving', icon: '🔐', shortLabel: 'Prove' },
  { id: 'uploading', label: 'Uploading', icon: '📤', shortLabel: 'Upload' },
  { id: 'verifying', label: 'Verifying', icon: '✓', shortLabel: 'Verify' },
  { id: 'claiming', label: 'Claiming', icon: '💰', shortLabel: 'Claim' },
] as const;

const stageHints: Record<string, string> = {
  generating: 'Creating proof in your browser...',
  uploading: 'Sending proof to network...',
  verifying: 'On-chain verification...',
  claiming: 'Transferring to your wallet...',
  complete: 'All done!',
};

// Friendly tip messages that rotate during proving
const provingTips = [
  'Your browser is doing math magic ✨',
  'Zero-knowledge = maximum privacy 🔒',
  'No one can see what you\'re proving 👀',
  'Almost there, hang tight! 🐈‍⬛',
];

// Estimate time based on stage
function estimateTimeRemaining(stage: Props['stage'], progress: number): string {
  if (stage === 'complete') return '';
  
  const estimates: Record<string, number> = {
    generating: Math.max(1, Math.round((100 - progress) * 0.15)),
    uploading: 3,
    verifying: 5,
    claiming: 3,
  };
  
  const seconds = estimates[stage] || 5;
  if (seconds < 60) return `~${seconds}s`;
  return `~${Math.ceil(seconds / 60)}m`;
}

// Trigger haptic feedback on supported devices
const triggerHaptic = (pattern: number | number[] = 10) => {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Silently fail if not supported
    }
  }
};

// Completion burst particles
const BurstParticles: FC<{ active: boolean }> = ({ active }) => {
  if (!active) return null;
  
  const particles = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    angle: (i / 12) * 360,
    delay: i * 0.03,
    scale: 0.5 + Math.random() * 0.5,
  }));
  
  return (
    <div className="burst-container" aria-hidden="true">
      {particles.map(p => (
        <motion.div
          key={p.id}
          className="burst-particle"
          initial={{ 
            scale: 0, 
            x: 0, 
            y: 0, 
            opacity: 1,
          }}
          animate={{ 
            scale: [0, p.scale, 0],
            x: Math.cos(p.angle * Math.PI / 180) * 60,
            y: Math.sin(p.angle * Math.PI / 180) * 60,
            opacity: [1, 1, 0],
          }}
          transition={{ 
            duration: 0.6, 
            delay: p.delay,
            ease: 'easeOut',
          }}
        />
      ))}
    </div>
  );
};

// Animated ring that fills as progress increases
const ProgressRing: FC<{ progress: number; isComplete: boolean }> = ({ progress, isComplete }) => {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;
  
  return (
    <svg 
      className="progress-ring-svg" 
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      {/* Background track */}
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        stroke="var(--bg-tertiary)"
        strokeWidth="4"
      />
      {/* Progress arc */}
      <motion.circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        stroke={isComplete ? 'var(--accent-success)' : 'var(--accent-primary)'}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        style={{ 
          transformOrigin: 'center',
          transform: 'rotate(-90deg)',
        }}
      />
    </svg>
  );
};

export const ProofProgress: FC<Props> = ({ stage, progress = 0, onComplete }) => {
  const [displayProgress, setDisplayProgress] = useState(0);
  const [showBurst, setShowBurst] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [prevStage, setPrevStage] = useState(stage);
  
  const currentStageIndex = stages.findIndex(s => s.id === stage);
  const currentStage = stages[currentStageIndex] || stages[0];
  const isComplete = stage === 'complete';
  
  // Smooth progress animation for generating stage
  useEffect(() => {
    if (stage === 'generating') {
      const timer = setInterval(() => {
        setDisplayProgress(prev => {
          const diff = progress - prev;
          if (Math.abs(diff) < 0.5) return progress;
          return prev + diff * 0.1;
        });
      }, 50);
      return () => clearInterval(timer);
    }
  }, [stage, progress]);

  // Rotate tips during proof generation
  useEffect(() => {
    if (stage === 'generating') {
      const timer = setInterval(() => {
        setTipIndex(prev => (prev + 1) % provingTips.length);
      }, 4000);
      return () => clearInterval(timer);
    }
  }, [stage]);

  // Haptic feedback on stage change
  useEffect(() => {
    if (stage !== prevStage) {
      setPrevStage(stage);
      
      if (stage === 'complete') {
        // Celebration pattern!
        triggerHaptic([30, 50, 30, 50, 60]);
        setShowBurst(true);
        setTimeout(() => setShowBurst(false), 800);
      } else {
        // Quick tap for stage progress
        triggerHaptic(15);
      }
    }
  }, [stage, prevStage]);

  // Fire complete callback
  useEffect(() => {
    if (stage === 'complete' && onComplete) {
      const timer = setTimeout(onComplete, 1500);
      return () => clearTimeout(timer);
    }
  }, [stage, onComplete]);

  const eta = estimateTimeRemaining(stage, progress);
  
  // Calculate overall progress percentage
  const overallProgress = isComplete 
    ? 100 
    : stage === 'generating'
      ? displayProgress * 0.6 // Generating is 60% of the journey
      : (currentStageIndex / stages.length) * 100 + 15;

  // Ring progress follows overall progress
  const ringProgress = isComplete ? 100 : overallProgress;
  
  return (
    <motion.div 
      className="proof-progress"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Main status with animated ring */}
      <div className="progress-hero">
        <div className="progress-icon-wrapper">
          {/* Circular progress ring */}
          <ProgressRing progress={ringProgress} isComplete={isComplete} />
          
          {/* Center icon */}
          <motion.div 
            className={`progress-icon-ring ${isComplete ? 'complete' : ''}`}
            animate={!isComplete ? { scale: [1, 1.03, 1] } : { scale: [1, 1.1, 1] }}
            transition={{ 
              duration: isComplete ? 0.4 : 1.5, 
              repeat: isComplete ? 0 : Infinity, 
              ease: 'easeInOut' 
            }}
          >
            <AnimatePresence mode="wait">
              <motion.span 
                key={isComplete ? 'check' : currentStage.id}
                className="progress-icon"
                initial={{ scale: 0.5, opacity: 0, rotate: -10 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.5, opacity: 0, rotate: 10 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              >
                {isComplete ? '✓' : currentStage.icon}
              </motion.span>
            </AnimatePresence>
          </motion.div>

          {/* Completion burst effect */}
          <BurstParticles active={showBurst} />
        </div>
        
        <motion.h2 
          className="progress-title"
          key={stage}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {isComplete ? 'Done!' : currentStage.label}
        </motion.h2>
        
        {stage === 'generating' && progress > 0 && (
          <motion.span 
            className="progress-percent"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            key={Math.round(progress)}
          >
            {Math.round(progress)}%
          </motion.span>
        )}
      </div>

      {/* Hint text - shows tips during generation */}
      <AnimatePresence mode="wait">
        <motion.p 
          className="progress-hint"
          key={stage === 'generating' ? `tip-${tipIndex}` : `hint-${stage}`}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.2 }}
        >
          {stage === 'generating' && progress > 20 
            ? provingTips[tipIndex] 
            : stageHints[stage]}
        </motion.p>
      </AnimatePresence>

      {/* Main progress bar */}
      <div className="progress-bar-wrapper">
        <div className="progress-bar-track">
          <motion.div 
            className={`progress-bar-fill ${isComplete ? 'complete' : ''}`}
            initial={{ width: 0 }}
            animate={{ width: `${overallProgress}%` }}
            transition={{ ease: 'easeOut', duration: 0.4 }}
          />
        </div>
        {eta && !isComplete && (
          <span className="progress-eta">{eta}</span>
        )}
      </div>

      {/* Step indicators - horizontal journey */}
      <div className="progress-steps" role="list" aria-label="Claim progress">
        {stages.map((s, idx) => {
          const isStepComplete = isComplete || idx < currentStageIndex;
          const isStepActive = !isComplete && idx === currentStageIndex;
          
          return (
            <div 
              key={s.id} 
              className={`progress-step ${isStepComplete ? 'complete' : ''} ${isStepActive ? 'active' : ''}`}
              role="listitem"
              aria-current={isStepActive ? 'step' : undefined}
            >
              {/* Connector line (before each step except first) */}
              {idx > 0 && (
                <motion.div 
                  className="step-connector"
                  initial={{ scaleX: 0 }}
                  animate={{ 
                    scaleX: isStepComplete ? 1 : 0,
                    backgroundColor: isStepComplete 
                      ? 'var(--accent-success)' 
                      : 'var(--bg-tertiary)',
                  }}
                  transition={{ duration: 0.4, delay: isStepComplete ? 0.1 : 0 }}
                  style={{ transformOrigin: 'left' }}
                />
              )}
              
              {/* Step circle */}
              <motion.div 
                className="step-circle"
                animate={isStepActive ? { 
                  scale: [1, 1.15, 1],
                  boxShadow: [
                    '0 0 0 0 rgba(61, 149, 206, 0)',
                    '0 0 0 4px rgba(61, 149, 206, 0.3)',
                    '0 0 0 0 rgba(61, 149, 206, 0)',
                  ],
                } : {}}
                transition={{ duration: 1, repeat: isStepActive ? Infinity : 0 }}
              >
                <AnimatePresence mode="wait">
                  {isStepComplete ? (
                    <motion.svg 
                      key="check"
                      viewBox="0 0 16 16" 
                      fill="currentColor" 
                      className="step-check"
                      initial={{ scale: 0, rotate: -90 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                    >
                      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                    </motion.svg>
                  ) : (
                    <motion.span 
                      key="number"
                      className="step-number"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                    >
                      {idx + 1}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
              
              {/* Step label */}
              <span className="step-label">{s.shortLabel}</span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};

export default ProofProgress;
