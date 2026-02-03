# Murkl Design System

**Inspiration: Venmo** — clean, friendly, minimal payment UX

## Core Principles

1. **One action per screen** — don't overwhelm
2. **Big, bold amounts** — make the number the hero
3. **Friendly, not clinical** — casual language, soft edges
4. **Trust through simplicity** — fewer elements = more confidence

## Layout

### Send Flow (Venmo-style)
```
┌─────────────────────────┐
│      [Wallet]     [···] │  ← minimal header
├─────────────────────────┤
│                         │
│         $0.00           │  ← BIG centered amount
│      ___________        │  ← subtle input line
│                         │
│    [SOL ▼] [USDC ▼]     │  ← token selector pills
│                         │
├─────────────────────────┤
│  ┌─────────────────┐    │
│  │   Send Private  │    │  ← primary action, full width
│  └─────────────────┘    │
│                         │
│  How it works →         │  ← subtle help link
└─────────────────────────┘
```

### Claim Flow
```
┌─────────────────────────┐
│      [Wallet]     [···] │
├─────────────────────────┤
│                         │
│    💰 You received      │  ← friendly header
│       1.5 SOL           │  ← amount highlight
│                         │
│  ┌─────────────────┐    │
│  │     Claim       │    │  ← single action
│  └─────────────────┘    │
│                         │
│  Proving... ████░░ 60%  │  ← progress when active
└─────────────────────────┘
```

## Color Palette

```css
/* Venmo-inspired but darker for crypto vibe */
--bg-primary: #0a0a0f;        /* near black */
--bg-secondary: #14141f;      /* card bg */
--bg-tertiary: #1e1e2e;       /* input bg */

--accent-primary: #3d95ce;    /* Venmo blue, muted */
--accent-success: #22c55e;    /* green for success */
--accent-warning: #f59e0b;    /* orange for pending */

--text-primary: #ffffff;
--text-secondary: #a1a1aa;
--text-muted: #52525b;

--border: #27272a;
--border-focus: #3d95ce;
```

## Typography

- **Amount display**: 48-64px, bold, white
- **Headers**: 18-24px, semibold
- **Body**: 14-16px, regular
- **Captions**: 12px, muted

## Components

### Amount Input
- Centered, large font
- Auto-resize based on digits
- Currency symbol prefix
- No visible border until focus
- Subtle underline or bottom border

### Action Button
- Full width on mobile
- Rounded (12-16px radius)
- Gradient or solid accent color
- Clear disabled state
- Loading spinner inside button (not separate)

### Token Selector
- Pill/chip style
- Icon + symbol
- Dropdown on tap
- Show balance underneath

### Progress Indicator
- Linear bar for proving progress
- Percentage + ETA
- Pulsing animation while active

### QR Code (for sharing)
- Clean white background
- Rounded corners
- "Scan to claim" label
- Copy link button below

## Animations

- **Page transitions**: Fade + slight slide (150ms)
- **Button press**: Scale down slightly (0.98)
- **Success**: Confetti or checkmark pop
- **Loading**: Subtle pulse on button

## Mobile First

- Touch targets: 44px minimum
- Bottom sheet for modals (not centered popups)
- Swipe gestures where natural
- Safe area padding

## Copy/Tone

**Do:**
- "Send privately" not "Create anonymous transfer"
- "Claim your funds" not "Execute withdrawal"
- "Proving..." not "Generating zero-knowledge proof"

**Don't:**
- Technical jargon in UI
- Long explanations
- Multiple CTAs competing

## States

### Empty State
- Friendly illustration
- "Send your first private payment"
- Single action button

### Loading
- Skeleton screens for content
- Spinner only for actions
- Always show progress %

### Error
- Red accent, not aggressive
- Clear message + retry action
- "Something went wrong. Try again?"

### Success
- Green checkmark animation
- Clear next action or dismiss
- Share option for sends
