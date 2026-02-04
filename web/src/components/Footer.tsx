import { memo, type FC } from 'react';
import { motion } from 'framer-motion';
import './Footer.css';

interface FooterLink {
  label: string;
  href: string;
  icon?: string;
}

const links: FooterLink[] = [
  { label: 'GitHub', href: 'https://github.com/exidz/murkl', icon: '⌨️' },
  { label: 'Colosseum', href: 'https://colosseum.org', icon: '🏛️' },
  { label: 'Docs', href: 'https://murkl.dev/docs', icon: '📚' },
];

/**
 * Venmo-inspired footer with:
 * - Subtle branding and tagline
 * - Social/resource links with hover animations
 * - Trust indicators (open source, privacy-focused)
 * - Responsive and accessible
 */
export const Footer: FC = memo(() => {
  return (
    <footer className="app-footer" role="contentinfo">
      {/* Tagline */}
      <div className="footer-tagline">
        <span className="footer-icon">🐈‍⬛</span>
        <p>Private payments, built in-browser</p>
      </div>

      {/* Links row */}
      <nav className="footer-links" aria-label="Footer navigation">
        {links.map((link, index) => (
          <motion.a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 + 0.1 }}
          >
            {link.icon && <span className="link-icon">{link.icon}</span>}
            <span className="link-label">{link.label}</span>
            <span className="link-arrow" aria-hidden="true">↗</span>
          </motion.a>
        ))}
      </nav>

      {/* Trust badges */}
      <div className="footer-badges">
        <span className="footer-badge">
          <span className="badge-icon">🔓</span>
          <span>Open Source</span>
        </span>
        <span className="footer-badge-divider" aria-hidden="true">•</span>
        <span className="footer-badge">
          <span className="badge-icon">🛡️</span>
          <span>Zero Knowledge</span>
        </span>
        <span className="footer-badge-divider" aria-hidden="true">•</span>
        <span className="footer-badge">
          <span className="badge-icon">⚡</span>
          <span>Solana</span>
        </span>
      </div>

      {/* Copyright - minimal */}
      <p className="footer-copyright">
        Built for{' '}
        <a 
          href="https://www.colosseum.org/hackathon" 
          target="_blank" 
          rel="noopener noreferrer"
        >
          Colosseum Agent Hackathon
        </a>
        {' '}2026
      </p>
    </footer>
  );
});

Footer.displayName = 'Footer';

export default Footer;
