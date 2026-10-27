import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "@/hooks/use-session";
import { useDisclaimerConsent } from "@/hooks/use-disclaimer";
import { useSelectedUserAddress } from "@/hooks/use-address";
import {
  GateContext,
  GATE_EVENT,
  activeGate,
  closeGate,
  unsatisfiedStep,
  type ActiveGate,
  type GateContextValue,
  type GateRequest,
} from "@/lib/gate";

interface GateState {
  record: ActiveGate;
  request: GateRequest;
}

function snapshot(record: ActiveGate): GateState {
  return { record, request: { ...record.request } };
}

export function GateProvider({ children }: { children: ReactNode }) {
  const { hasBudget, hasStreamBudget } = useSession();
  const { hasConsented } = useDisclaimerConsent();
  const { userAddress } = useSelectedUserAddress();
  const [gate, setGate] = useState<GateState | null>(() => {
    const record = activeGate();
    return record ? snapshot(record) : null;
  });

  useEffect(() => {
    const adopt = (event: Event) => setGate(snapshot((event as CustomEvent<ActiveGate>).detail));
    window.addEventListener(GATE_EVENT, adopt);
    return () => window.removeEventListener(GATE_EVENT, adopt);
  }, []);

  const loggedIn = Boolean(userAddress);
  const consented = hasConsented;
  const funded = gate?.request.action === 'stream' ? hasStreamBudget : hasBudget;

  useEffect(() => {
    if (gate && !gate.request.force && !unsatisfiedStep(gate.request, { loggedIn, consented, funded })) {
      setGate(null);
      closeGate(true);
    }
  }, [gate, loggedIn, consented, funded]);

  const cancel = useCallback(() => {
    setGate(null);
    closeGate(false);
  }, []);

  const value = useMemo<GateContextValue>(
    () => ({ request: gate?.request ?? null, cancel }),
    [gate, cancel],
  );

  return <GateContext.Provider value={value}>{children}</GateContext.Provider>;
}
