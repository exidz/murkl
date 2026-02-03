# Murkl Demo Video Script

**Duration:** 2-3 minutes
**Format:** Screen recording + voiceover

---

## Intro (15 sec)

**Visual:** Murkl logo / landing page

**Script:**
> "Murkl is the first full STARK verifier running on Solana. It enables anonymous social transfers — send tokens to anyone using their social identifier, they claim with a password. No KYC, full privacy, post-quantum secure."

---

## The Problem (20 sec)

**Visual:** Show traditional crypto transfer (wallet-to-wallet)

**Script:**
> "Traditional crypto transfers require you to know someone's wallet address. But what if you want to send money to a friend who isn't crypto-native? Or send anonymously without linking your wallet to theirs?"

---

## The Solution (30 sec)

**Visual:** Show Murkl UI - Send Tab

**Script:**
> "With Murkl, you deposit tokens using a simple identifier — like an email or Twitter handle — plus a password. Share the password however you want: Signal, phone call, in person."

**Action:**
1. Connect wallet (Phantom)
2. Enter identifier: `@demo_user`
3. Enter/generate password
4. Enter amount: `0.05 SOL`
5. Click Deposit
6. Show success + QR code

---

## The Claim (45 sec)

**Visual:** Switch to Claim Tab (different browser/wallet)

**Script:**
> "The recipient doesn't even need to sign anything. They enter the identifier and password, and Murkl generates a zero-knowledge STARK proof client-side in their browser."

**Action:**
1. Show Claim Tab
2. Paste share link or enter manually
3. Enter recipient wallet address
4. Click "Generate Proof"
5. Show proof generation (~5 seconds)
6. Show "Submitting to relayer..."
7. Show success + explorer link

**Script:**
> "The proof proves they know the password without revealing it. The relayer submits the transaction, paying the gas fee and taking a small service fee. The recipient never signed anything — complete privacy."

---

## Technical Deep Dive (30 sec)

**Visual:** Split screen: Code / Architecture diagram

**Script:**
> "Under the hood, Murkl uses Circle STARKs over the Mersenne-31 field. This is the first time a full STARK verifier has run on Solana. Unlike SNARKs, STARKs have no trusted setup and are post-quantum secure."

**Visual:** Show explorer transaction

**Script:**
> "Proof verification uses about 40,000 compute units — well within Solana's 1.4 million limit. The 6KB proof is uploaded in chunks and verified on-chain."

---

## Use Cases (20 sec)

**Visual:** Icons/illustrations for each

**Script:**
> "Use cases include: anonymous donations to journalists or activists, private salary payments, gifting crypto to friends without revealing your wallet, and any transfer where privacy matters."

---

## Closing (15 sec)

**Visual:** GitHub repo + devnet addresses

**Script:**
> "Murkl is live on Solana devnet right now. Check out the GitHub repo to try it yourself. First full STARK verifier on Solana — post-quantum secure, zero trusted setup."

**Show:**
- GitHub: github.com/exidz/murkl
- Program: `74P7nTyt...`
- Pool: `HBdNYy8C...`

---

## Recording Notes

### Setup
- [ ] Two browser windows (sender + recipient)
- [ ] Phantom wallet with devnet SOL
- [ ] Local relayer running (`npm run dev`)
- [ ] Frontend running (`npm run dev`)

### Test Flow Before Recording
1. Make test deposit with unique identifier
2. Claim in separate browser session
3. Verify both transactions on explorer

### Audio
- Record voiceover separately for cleaner audio
- Background music: subtle, techy, non-distracting

### Timing
- Aim for 2:30-3:00 total
- Speed up proof generation if it takes too long
- Cut/edit waiting periods

### Thumbnail
- Dark theme with green accent
- "First STARK Verifier on Solana"
- Murkl logo
