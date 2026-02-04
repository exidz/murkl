import { useState, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import toast from '../components/Toast';
import { RELAYER_URL, POOL_ADDRESS } from '../lib/constants';
import { generate_proof } from '../wasm/murkl_wasm';

// WSOL mint address
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

export type ClaimStage = 'idle' | 'generating' | 'uploading' | 'verifying' | 'claiming' | 'complete';

export interface ClaimParams {
  identifier: string;
  password: string;
  leafIndex: number;
  pool?: string;
}

export interface ClaimFlowState {
  stage: ClaimStage;
  proofProgress: number;
  successSignature: string | null;
}

/**
 * Custom hook encapsulating the entire claim pipeline:
 * generate proof → upload → verify → claim.
 *
 * Deduplicates the logic previously copy-pasted in both
 * `executeClaim` (OAuth flow) and `handleLandingClaim` (claim link flow).
 */
export function useClaimFlow(wasmReady: boolean) {
  const { publicKey } = useWallet();

  const [stage, setStage] = useState<ClaimStage>('idle');
  const [proofProgress, setProofProgress] = useState(0);
  const [successSignature, setSuccessSignature] = useState<string | null>(null);

  // Keep a ref so the progress interval can be cleared from anywhere
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    setStage('idle');
    setProofProgress(0);
    setSuccessSignature(null);
  }, []);

  /**
   * Execute the full claim pipeline.
   * Returns `true` on success, `false` on failure.
   */
  const executeClaim = useCallback(async (params: ClaimParams): Promise<boolean> => {
    if (!publicKey || !wasmReady) return false;

    const poolAddress = params.pool || POOL_ADDRESS.toBase58();

    setStage('generating');
    setProofProgress(0);
    setSuccessSignature(null);

    try {
      // Simulate proof progress
      progressIntervalRef.current = setInterval(() => {
        setProofProgress(prev => {
          if (prev >= 95) {
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
            return prev;
          }
          return prev + Math.random() * 8 + 2;
        });
      }, 200);

      // Fetch merkle root from pool
      let merkleRoot = '0'.repeat(64);
      if (RELAYER_URL) {
        try {
          const poolInfoRes = await fetch(`${RELAYER_URL}/pool-info?pool=${poolAddress}`);
          if (poolInfoRes.ok) {
            const poolInfo = await poolInfoRes.json();
            merkleRoot = poolInfo.merkleRoot || merkleRoot;
          }
        } catch {
          // Use default
        }
      }

      // Generate proof
      console.log('[CLAIM] Generating proof with:', {
        identifier: params.identifier,
        passwordLength: params.password.length,
        leafIndex: params.leafIndex,
        merkleRoot: merkleRoot.slice(0, 16) + '...',
      });

      const proofResult = await generate_proof(
        params.identifier,
        params.password,
        params.leafIndex,
        merkleRoot,
      );

      console.log('[CLAIM] Proof result:', {
        commitment: proofResult.commitment,
        nullifier: proofResult.nullifier?.slice(0, 16) + '...',
        proofSize: proofResult.proof?.length,
      });

      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setProofProgress(100);

      if (proofResult.error) {
        throw new Error(proofResult.error);
      }

      // Upload proof
      setStage('uploading');
      await new Promise(r => setTimeout(r, 500)); // Brief UX pause

      // Submit to relayer
      setStage('verifying');
      const recipientATA = await getAssociatedTokenAddress(WSOL_MINT, publicKey);

      const response = await fetch(`${RELAYER_URL}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proof: proofResult.proof,
          commitment: proofResult.commitment,
          nullifier: proofResult.nullifier,
          recipientTokenAccount: recipientATA.toBase58(),
          poolAddress,
          leafIndex: params.leafIndex,
          feeBps: 50,
        }),
      });

      if (!response.ok) {
        throw new Error('Claim failed — try again');
      }

      const result = await response.json();

      // Claiming
      setStage('claiming');
      await new Promise(r => setTimeout(r, 500));

      // Success!
      setStage('complete');
      setSuccessSignature(result.signature || null);
      toast.success('Claimed! 🎉');

      return true;
    } catch (error: unknown) {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      const message = error instanceof Error ? error.message : 'Claim failed';
      toast.error(message);
      setStage('idle');
      return false;
    }
  }, [publicKey, wasmReady]);

  return {
    stage,
    proofProgress,
    successSignature,
    executeClaim,
    reset,
  } as const;
}
