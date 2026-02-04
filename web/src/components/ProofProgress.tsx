import { useState, useEffect, type FC } from 'react';
import { motion } from 'framer-motion';
import './ProofProgress.css';

interface Props {
  stage: 'generating' | 'uploading' | 'verifying' | 'claiming' | 'complete';
  progress?: number; // 0-100 for generating stage
  onComplete?: () => void;
}

const stageConfig = {
  generating: { label: 'Proving', icon: '🔐', hint: 'Creating STARK proof in your browser' },
  uploading: { label: 'Uploading', icon: '📤', hint: 'Sending proof to network' },
  verifying: { label: 'Verifying', icon: '✓', hint: 'On-chain verification' },
  claiming: { label: 'Claiming', icon: '💰', hint: 'Sending to your wallet' },
  complete: { label: 'Done!', icon: '🎉', hint: 'Funds are yours' },
};

// Estimate time based on stage
function estimateTimeRemaining(stage: Props['stage'], progress: number): string {
  if (stage === 'complete') return '';
  
  // Rough estimates in seconds
  const estimates: Record<string, number> = {
    generating: Math.max(1, Math.round((100 - progress) * 0.15)), // ~15s total for proof
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
  const config = stageConfig[stage];
  
  // Smooth progress animation
  useEffect(() => {
    if (stage === 'generating') {
      // Animate to actual progress
      const timer = setInterval(() => {
        setDisplayProgress(prev => {
          const diff = progress - prev;
          if (Math.abs(diff) < 0.5) return progress;
          return prev + diff * 0.1;
        });
      }, 50);
      return () => clearInterval(timer);
    } else {
      // For other stages, show stage-based progress
      const stageProgress: Record<string, number> = {
        generating: 25,
        uploading: 50,
        verifying: 75,
        claiming: 90,
        complete: 100,
      };
      setDisplayProgress(stageProgress[stage] || 0);
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
  
  return (
    <motion.div 
      className="proof-progress"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Main icon with pulse */}
      <motion.div 
        className="progress-icon-container"
        animate={stage !== 'complete' ? { scale: [1, 1.1, 1] } : {}}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        <span className="progress-main-icon">{config.icon}</span>
      </motion.div>

      {/* Stage label */}
      <div className="progress-label-row">
        <span className="progress-stage-label">{config.label}</span>
        {stage === 'generating' && progress > 0 && (
          <span className="progress-percent">{Math.round(progress)}%</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="progress-bar-container">
        <div className="progress-bar-track">
          <motion.div 
            className="progress-bar-fill"
            initial={{ width: 0 }}
            animate={{ width: `${displayProgress}%` }}
            transition={{ ease: 'easeOut', duration: 0.3 }}
          />
        </div>
        {eta && <span className="progress-eta">{eta}</span>}
      </div>

      {/* Hint text */}
      <p className="progress-hint">{config.hint}</p>

      {/* Stage dots */}
      <div className="progress-dots">
        {(['generating', 'uploading', 'verifying', 'claiming'] as const).map((s, i) => {
          const stageIndex = ['generating', 'uploading', 'verifying', 'claiming'].indexOf(stage);
          const isComplete = stage === 'complete' || i < stageIndex;
          const isActive = i === stageIndex;
          
          return (
            <motion.div 
              key={s}
              className={`progress-dot ${isComplete ? 'complete' : ''} ${isActive ? 'active' : ''}`}
              initial={false}
              animate={isActive ? { scale: [1, 1.2, 1] } : { scale: 1 }}
              transition={{ duration: 0.8, repeat: isActive ? Infinity : 0 }}
            />
          );
        })}
      </div>
    </motion.div>
  );
};

export default ProofProgress;
