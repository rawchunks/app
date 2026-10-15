import { sdk } from '@/lib/sdk';
import { useState, useCallback } from "react";
import { useActiveAccount, useActiveWallet } from "thirdweb/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert,
  ShieldCheck,
  Cpu,
  AlertTriangle,
  FileText,
  Lock,
  Check,
  LogOut,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/button";
import { Badge } from "@/components/badge";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { toast } from "sonner";

export const DISCLAIMER_POLICY_VERSION = "1.0.0";
export const DISCLAIMER_TYPE = "ai_passthrough";

interface DisclaimerModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  forceOpen?: boolean;
}

const POINTS = [
  {
    icon: Cpu,
    term: "Technical conduit",
    text: "RawChunks acts solely as a technical relay to generation models operated by independent third-party providers. RawChunks does not own, operate, or validate those providers.",
  },
  {
    icon: FileText,
    term: "Third-party governance",
    text: "Your briefs, pictures, and transmitted inputs are governed by each provider's terms of service and privacy policy where they apply.",
  },
  {
    icon: Lock,
    term: "Zero training on your data",
    text: "RawChunks does not use your prompts, likeness material, or outputs to train general models, and prohibits upstream providers from doing so on its behalf.",
  },
  {
    icon: AlertTriangle,
    term: "Probabilistic outputs",
    text: "Generated audio, music, and lyrics are probabilistic, may contain inaccuracies, and do not constitute professional advice. You assume the risks of publication.",
  },
  {
    icon: ShieldCheck,
    term: "Discharge of liability",
    text: "RawChunks is not liable for damages arising from third-party provider acts, service interruptions, model omissions, or data handling.",
  },
] as const;

export function DisclaimerModal({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  forceOpen = false,
}: DisclaimerModalProps) {
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const { userAddress, evmAddress, svmAddress } = useSelectedUserAddress();
  const queryClient = useQueryClient();

  const [relayAgreed, setRelayAgreed] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);

  const activeAddress = userAddress;

  const isOpen = controlledOpen !== undefined ? controlledOpen : forceOpen || internalOpen;
  const setOpen = controlledOnOpenChange || setInternalOpen;

  const handleDisconnect = useCallback(() => {
    setOpen(false);
    wallet?.disconnect();
  }, [wallet, setOpen]);

  const generateSignatureMessage = useCallback((address: string, timestamp: string) => {
    return [
      "=== RawChunks GENERATION DISCLAIMER & TERMS ===",
      `Policy Version: ${DISCLAIMER_POLICY_VERSION} (2026-09-22)`,
      `Signer Address: ${address}`,
      `Timestamp: ${timestamp}`,
      "",
      "By signing this statement, you acknowledge and agree that:",
      "1. Technical Conduit: RawChunks acts solely as a technical relay to generation models operated by independent third-party providers. We do not own, operate, or validate these third-party models.",
      "2. Third-Party Governance: Your prompts, inputs, and transmitted data are governed by each applicable provider's terms of service and privacy policy.",
      "3. Zero General Training: RawChunks does not use your data to train general models, and we prohibit upstream providers from doing so on our behalf.",
      "4. Probabilistic Outputs: Generated outputs are probabilistic, may contain inaccuracies, and do not constitute professional advice. You assume all risks.",
      "5. Discharge of Liability: RawChunks disclaims all liability for third-party provider acts, omissions, outages, data handling, and outputs.",
    ].join("\n");
  }, []);

  const signAndAccept = useCallback(async () => {
    if (!activeAddress) return;
    setIsSigning(true);
    try {
      const timestamp = new Date().toISOString();
      const message = generateSignatureMessage(activeAddress, timestamp);
      if (!account) throw new Error('Connect your account before signing');
      const signature = await account.signMessage({ message });

      // Record consent in Neon User DB
      const res = await sdk.fetch("/api/user/consent", {
        method: "POST",
        userAddress: activeAddress,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: activeAddress,
          svmAddress: svmAddress || undefined,
          signature,
          message,
          disclaimerType: DISCLAIMER_TYPE,
          policyVersion: DISCLAIMER_POLICY_VERSION,
          metadata: { evmAddress, signedAt: timestamp },
        }),
      });

      if (!res.ok) {
        const result = await res.json().catch(() => null);
        throw new Error(result?.error || `Could not record consent (HTTP ${res.status}).`);
      }

      await queryClient.invalidateQueries({
        queryKey: ["user-consent"],
      });

      toast.success("Disclaimer signed and recorded", {
        description: `Recorded for ${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}.`,
      });
      setRelayAgreed(false);
      setTermsAgreed(false);
      setOpen(false);
    } catch (cause) {
      toast.error("Could not complete disclaimer", {
        description: cause instanceof Error ? cause.message : "An unexpected error occurred.",
      });
    } finally {
      setIsSigning(false);
    }
  }, [account, activeAddress, evmAddress, svmAddress, generateSignatureMessage, setOpen, queryClient]);

  const canSign = relayAgreed && termsAgreed && !isSigning && Boolean(activeAddress);

  return (
    <Dialog open={isOpen} onOpenChange={setOpen} compulsory={forceOpen}>
      <DialogContent>
        <DialogHeader>
          <span className="dialog-side">
            <ShieldAlert className="icon icon-gold" aria-hidden="true" />
            <Badge variant="primary">Compliance</Badge>
          </span>
          <DialogTitle>Generation pass-through &amp; liability</DialogTitle>
          <span className="dialog-version">VERSION {DISCLAIMER_POLICY_VERSION}</span>
        </DialogHeader>
        <div className="dialog-body">
          <DialogDescription>
            Review and sign the generation pass-through terms before you mint, license, or direct renders on RawChunks.
          </DialogDescription>

          <div className="scrollable terms">
            {POINTS.map((point, index) => (
              <div key={point.term} className="spec">
                <span className="spec-num">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h4 className="spec-term">
                    <point.icon className="icon icon-gold" aria-hidden="true" />
                    {point.term}
                  </h4>
                  <p className="spec-text">{point.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="checks">
            <label className="check">
              <Checkbox
                checked={relayAgreed}
                onCheckedChange={(checked: boolean) => setRelayAgreed(Boolean(checked))}
              />
              <span>
                I understand RawChunks is a <strong>technical relay</strong> to independent generation providers and I agree to the pass-through terms and liability waiver.
              </span>
            </label>

            <label className="check">
              <Checkbox
                checked={termsAgreed}
                onCheckedChange={(checked: boolean) => setTermsAgreed(Boolean(checked))}
              />
              <span>
                I have read and agree to the RawChunks terms of service and privacy policy.
              </span>
            </label>
          </div>

          {activeAddress ? (
            <p className="signing">
              Signing account
              <b>{activeAddress.slice(0, 6)}...{activeAddress.slice(-4)}</b>
            </p>
          ) : null}

          <div className="actions dialog-actions">
            <Button variant="outline" size="sm" onClick={handleDisconnect}>
              <LogOut className="icon" />
              Disconnect
            </Button>

            <Button disabled={!canSign} onClick={() => void signAndAccept()}>
              {isSigning ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Signing
                </>
              ) : (
                <>
                  <Check className="icon" />
                  Sign &amp; accept
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
