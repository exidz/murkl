import type { FC } from 'react';
import './ProofProgress.css';

interface Props {
  stage: 'generating' | 'uploading' | 'verifying' | 'claiming';
  progress?: number;
}

const stages = [
  { id: 'generating', label: 'Generating Proof', icon: '🔐' },
  { id: 'uploading', label: 'Uploading', icon: '📤' },
  { id: 'verifying', label: 'Verifying', icon: '✓' },
  { id: 'claiming', label: 'Claiming', icon: '💰' },
];

export const ProofProgress: FC<Props> = ({ stage, progress: _progress }) => {
  const currentIndex = stages.findIndex(s => s.id === stage);
  
  return (
    <div className="proof-progress">
      <div className="progress-header">
        <span className="progress-icon">{stages[currentIndex]?.icon}</span>
        <span className="progress-label">{stages[currentIndex]?.label}</span>
      </div>
      
      <div className="progress-bar">
        <div 
          className="progress-fill" 
          style={{ width: `${((currentIndex + 1) / stages.length) * 100}%` }}
        />
      </div>
      
      <div className="progress-stages">
        {stages.map((s, i) => (
          <div 
            key={s.id} 
            className={`stage ${i < currentIndex ? 'complete' : i === currentIndex ? 'active' : ''}`}
          >
            <span className="stage-dot" />
            <span className="stage-label">{s.label}</span>
          </div>
        ))}
      </div>
      
      {stage === 'generating' && (
        <p className="progress-hint">
          🐈‍⬛ Generating STARK proof in your browser...
          <br />
          <small>This may take a few seconds</small>
        </p>
      )}
    </div>
  );
};
