import { useState } from 'react';
import type { FC } from 'react';
import './OAuthLogin.css';

interface OAuthProvider {
  id: 'twitter' | 'discord' | 'google';
  name: string;
  icon: string;
  color: string;
}

const providers: OAuthProvider[] = [
  { id: 'twitter', name: 'Twitter', icon: '𝕏', color: '#000000' },
  { id: 'discord', name: 'Discord', icon: '🎮', color: '#5865F2' },
  { id: 'google', name: 'Google', icon: '🔵', color: '#4285F4' },
];

interface Props {
  onLogin: (provider: string, identity: string) => void;
  loading?: boolean;
}

export const OAuthLogin: FC<Props> = ({ onLogin, loading }) => {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const handleOAuth = async (provider: OAuthProvider) => {
    setSelectedProvider(provider.id);
    
    // In production, this would redirect to OAuth flow
    // For demo, we'll simulate with a prompt
    const mockIdentities: Record<string, string> = {
      twitter: '@user',
      discord: 'user#1234',
      google: 'user@gmail.com',
    };

    // Simulate OAuth delay
    await new Promise(r => setTimeout(r, 500));
    
    // For demo - in production this comes from OAuth callback
    const identity = prompt(`Enter your ${provider.name} handle:`, mockIdentities[provider.id]);
    
    if (identity) {
      onLogin(provider.id, identity);
    }
    setSelectedProvider(null);
  };

  return (
    <div className="oauth-login">
      <h3>🔐 Verify Your Identity</h3>
      <p className="oauth-subtitle">
        Sign in to see deposits sent to you
      </p>
      
      <div className="oauth-buttons">
        {providers.map(provider => (
          <button
            key={provider.id}
            className={`oauth-btn oauth-${provider.id}`}
            onClick={() => handleOAuth(provider)}
            disabled={loading || selectedProvider !== null}
            style={{ '--provider-color': provider.color } as React.CSSProperties}
          >
            <span className="oauth-icon">{provider.icon}</span>
            <span className="oauth-text">
              {selectedProvider === provider.id ? 'Connecting...' : `Continue with ${provider.name}`}
            </span>
          </button>
        ))}
      </div>

      <div className="oauth-divider">
        <span>or enter manually</span>
      </div>
    </div>
  );
};
