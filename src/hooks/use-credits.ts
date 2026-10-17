import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveWallet, useAdminWallet } from 'thirdweb/react';
import { useSelectedUserAddress } from './use-address';
import { useChain } from '../contexts/Network';
import { setCreditRequestContext } from '../lib/sdk';
import { creditsApi, DEFAULT_CREDIT_PACKS, DEFAULT_PAYPAL_CLIENT_ID, prepaidSession, purchaseCacheKey, zeroCredits, type CreditBalance, type CreditSession } from '../lib/credits';
import type { SessionState } from './use-session';

export function useCreditAccount() {
  const admin = useAdminWallet(), active = useActiveWallet();
  const wallet = admin ?? active;
  const { userAddress, evmAddress } = useSelectedUserAddress();
  const { selectedNetwork } = useChain();
  const owner = evmAddress?.toLowerCase() ?? null;
  const authToken = wallet?.getAuthToken?.() ?? null;
  const identity = `${owner}:${authToken}`;
  const latest = useRef({ identity, userAddress, selectedNetwork });
  latest.current = { identity, userAddress, selectedNetwork };
  const [state, setState] = useState<{ identity: string; balance: CreditBalance; session: SessionState | null; error: string | null }>({ identity: '', balance: zeroCredits, session: null, error: null });
  const current = state.identity === identity ? state : {
    balance: {
      ...zeroCredits,
      packs: state.balance.packs.length > 0 ? state.balance.packs : DEFAULT_CREDIT_PACKS,
      paypalClientId: state.balance.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
      environment: state.balance.environment,
    },
    session: null,
    error: null,
  };
  const [loading, setLoading] = useState(false);
  const sessionRef = useRef(current.session);
  sessionRef.current = current.session;
  const enabled = Boolean(owner && userAddress && authToken);
  useEffect(() => {
    setCreditRequestContext(enabled ? { userAddress: userAddress!, authToken: authToken!, sessionToken: current.session?.active ? current.session.token : null } : null);
    return () => setCreditRequestContext(null);
  }, [identity, userAddress, current.session?.token, current.session?.active]);

  const refresh = useCallback(async (resumeId?: string) => {
    if (!enabled) return;
    try {
      const id = resumeId ?? sessionRef.current?.keyId;
      const [rawBalance, initialRow] = await Promise.all([
        creditsApi<CreditBalance>('balance'),
        id
          ? creditsApi<CreditSession>(`session/${encodeURIComponent(id)}`)
          : creditsApi<{ sessions: CreditSession[] }>('sessions').then(result => result.sessions[0]),
      ]);
      const balance: CreditBalance = {
        ...rawBalance,
        packs: rawBalance.packs?.length ? rawBalance.packs : DEFAULT_CREDIT_PACKS,
        paypalClientId: rawBalance.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
      };
      let row = initialRow;
      if (row && !row.closed && row.expiresAt > Date.now() && !row.token) row = await creditsApi<CreditSession>('session/resume', { sessionId: row.id });
      if (latest.current.identity !== identity) return;
      const session = row && !row.closed && row.expiresAt > Date.now() ? prepaidSession(row, latest.current.userAddress!, latest.current.selectedNetwork) : null;
      setState({ identity, balance, session, error: null });
    } catch (error) {
      if (latest.current.identity === identity) setState(previous => ({ ...(previous.identity === identity ? previous : { balance: zeroCredits, session: null }), identity, error: error instanceof Error ? error.message : 'Credits unavailable' }));
    }
  }, [identity, enabled]);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    void refresh().finally(() => { if (latest.current.identity === identity) setLoading(false); });
    const timer = setInterval(() => void refresh(), 10000);
    const recover = () => void refresh();
    window.addEventListener('focus', recover);
    return () => { clearInterval(timer); window.removeEventListener('focus', recover); };
  }, [refresh, identity]);

  const completePurchase = useCallback(async (operationId: string) => {
    const operation = await creditsApi<{ status: string; sessionId: string | null }>(`operations/${operationId}`);
    if (operation.status !== 'credited') throw new Error('Payment is still being confirmed');
    await refresh(operation.sessionId ?? undefined);
    if (owner) localStorage.removeItem(purchaseCacheKey(owner));
  }, [refresh, owner]);
  useEffect(() => {
    if (!enabled || !owner) return;
    let cancelled = false;
    const recover = async () => {
      const operationId = localStorage.getItem(purchaseCacheKey(owner));
      if (!operationId) return;
      try { if (!cancelled) await completePurchase(operationId); } catch { /* Backend reconciliation and the next poll recover a pending capture. */ }
    };
    void recover();
    const timer = setInterval(() => void recover(), 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [identity, enabled, owner, completePurchase]);

  const start = useCallback(async (budgetAtomics: string, durationHours: number) => {
    if (!enabled) throw new Error('Connect your account first');
    const row = await creditsApi<CreditSession>('session/start', { budgetAtomics, durationSeconds: durationHours * 3600 }, crypto.randomUUID());
    if (latest.current.identity !== identity) throw new Error('The account changed');
    setState(previous => ({ ...previous, identity, session: prepaidSession(row, latest.current.userAddress!, latest.current.selectedNetwork), error: null }));
    await refresh(row.id);
  }, [enabled, identity, refresh]);
  const end = useCallback(async () => {
    const id = sessionRef.current?.keyId;
    if (!id) return;
    await creditsApi('session/end', { sessionId: id });
    if (latest.current.identity !== identity) return;
    setState(previous => ({ ...previous, session: null }));
    sessionRef.current = null;
    await refresh();
  }, [identity, refresh]);
  return { owner, enabled, balance: current.balance, session: current.session ? { ...current.session, userAddress, network: selectedNetwork } : null,
    error: current.error, loading, refresh, start, end, completePurchase };
}
