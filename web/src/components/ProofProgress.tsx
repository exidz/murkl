import { useState, useEffect, type FC } from 'react';
import { motion } from 'framer-motion';
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

export const ProofProgress: FC<Props> = ({ stage, progress = 0, onComplete }) => {
  const [displayProgress, setDisplayProgress] = useState(0);
  
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

  // Fire complete callback
  useEffect(() => {
    if (stage === 'complete' && onComplete) {
      const timer = setTimeout(onComplete, 1000);
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
  
  return (
    <motion.div 
      className="proof-progress"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Main status with pulsing icon */}
      <div className="progress-hero">
        <motion.div 
          className={`progress-icon-ring ${isComplete ? 'complete' : ''}`}
          animate={!isComplete ? { scale: [1, 1.05, 1] } : {}}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          <span className="progress-icon">{isComplete ? '✓' : currentStage.icon}</span>
        </motion.div>
        
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
          >
            {Math.round(progress)}%
          </motion.span>
        )}
      </div>

      {/* Hint text */}
      <motion.p 
        className="progress-hint"
        key={`hint-${stage}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {stageHints[stage]}
      </motion.p>

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
                <div className={`step-connector ${isStepComplete ? 'complete' : ''}`} />
              )}
              
              {/* Step circle */}
              <motion.div 
                className="step-circle"
                animate={isStepActive ? { scale: [1, 1.15, 1] } : {}}
                transition={{ duration: 1, repeat: isStepActive ? Infinity : 0 }}
              >
                {isStepComplete ? (
                  <svg viewBox="0 0 16 16" fill="currentColor" className="step-check">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                  </svg>
                ) : (
                  <span className="step-number">{idx + 1}</span>
                )}
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
