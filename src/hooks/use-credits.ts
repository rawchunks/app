import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveWallet, useAdminWallet } from 'thirdweb/react';
import { useSelectedUserAddress } from './use-address';
import { readCachedCredits, readCachedPayPalClientId, writeCachedCredits, writeCachedPayPalClientId } from '../lib/cache';
import { creditsApi, DEFAULT_PAYPAL_CLIENT_ID, purchaseCacheKey, zeroCredits, type CreditBalance } from '../lib/credits';

export function useCreditAccount() {
  const admin = useAdminWallet(), active = useActiveWallet();
  const wallet = admin ?? active;
  const { userAddress, readAddress, accountId, isReconnecting } = useSelectedUserAddress();
  const owner = accountId ?? readAddress?.toLowerCase() ?? null;
  const authToken = wallet?.getAuthToken?.() ?? null;
  const identity = `${owner}:${authToken}`;
  const latest = useRef({ identity, owner, userAddress });
  latest.current = { identity, owner, userAddress };
  const mutationGenRef = useRef(0);

  const [state, setState] = useState<{ identity: string; owner: string | null; balance: CreditBalance; error: string | null }>(() => {
    const initialOwner = owner;
    const cachedSnap = readCachedCredits(initialOwner);
    const cachedPayPal = readCachedPayPalClientId();
    const initialBalance: CreditBalance = cachedSnap?.balance
      ? {
          ...cachedSnap.balance,
          packs: cachedSnap.balance.packs ?? [],
          paypalClientId: cachedSnap.balance.paypalClientId || cachedPayPal?.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
          environment: cachedSnap.balance.environment || cachedPayPal?.environment || 'sandbox',
        }
      : {
          ...zeroCredits,
          paypalClientId: cachedPayPal?.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
          environment: cachedPayPal?.environment || 'sandbox',
        };
    return {
      identity: `${initialOwner}:${authToken}`,
      owner: initialOwner,
      balance: initialBalance,
      error: null,
    };
  });

  const cachedSnapForOwner = state.owner === owner ? null : readCachedCredits(owner);
  const cachedPayPal = readCachedPayPalClientId();
  const current = state.owner === owner
    ? state
    : {
        balance: cachedSnapForOwner?.balance
          ? {
              ...cachedSnapForOwner.balance,
              packs: cachedSnapForOwner.balance.packs ?? [],
              paypalClientId: cachedSnapForOwner.balance.paypalClientId || state.balance.paypalClientId || cachedPayPal?.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
              environment: cachedSnapForOwner.balance.environment || state.balance.environment || cachedPayPal?.environment || 'sandbox',
            }
          : {
              ...zeroCredits,
              promo: owner === null ? state.balance.promo : zeroCredits.promo,
              packs: state.balance.packs,
              paypalClientId: state.balance.paypalClientId || cachedPayPal?.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
              environment: state.balance.environment || cachedPayPal?.environment || 'sandbox',
            },
        error: null,
      };

  const [loading, setLoading] = useState(false);
  const enabled = Boolean(owner && userAddress && authToken);

  useEffect(() => {
    if (owner || isReconnecting) return;
    let cancelled = false;
    setLoading(true);
    void creditsApi<Partial<CreditBalance>>('promo')
      .then((data) => {
        if (cancelled || latest.current.owner !== null) return;
        const paypalClientId = data.paypalClientId || readCachedPayPalClientId()?.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID;
        const environment = data.environment || readCachedPayPalClientId()?.environment || 'sandbox';
        if (data.paypalClientId) writeCachedPayPalClientId(data.paypalClientId, environment);
        setState((prev) => ({
          ...prev,
          identity: latest.current.identity,
          owner: null,
          balance: {
            ...zeroCredits,
            promo: data.promo ?? prev.balance.promo,
            packs: data.packs?.length ? data.packs : prev.balance.packs,
            paypalClientId,
            environment,
          },
          error: null,
        }));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled && latest.current.owner === null) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, isReconnecting]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const gen = mutationGenRef.current;
    try {
      const rawBalance = await creditsApi<CreditBalance>('balance');
      if (latest.current.identity !== identity || mutationGenRef.current !== gen) return;
      const balance: CreditBalance = {
        ...rawBalance,
        packs: rawBalance.packs ?? [],
        paypalClientId: rawBalance.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
      };
      if (latest.current.owner) {
        writeCachedCredits(latest.current.owner, balance);
      }
      if (balance.paypalClientId) {
        writeCachedPayPalClientId(balance.paypalClientId, balance.environment || 'sandbox');
      }
      setState({ identity, owner: latest.current.owner, balance, error: null });
    } catch (error) {
      if (latest.current.identity === identity && mutationGenRef.current === gen) {
        setState(previous => ({
          ...(previous.owner === latest.current.owner ? previous : { balance: zeroCredits }),
          identity,
          owner: latest.current.owner,
          error: error instanceof Error ? error.message : 'Credits unavailable',
        }));
      }
    }
  }, [identity, enabled]);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    void refresh().finally(() => { if (latest.current.identity === identity) setLoading(false); });
    const timer = setInterval(() => void refresh(), 15000);
    const recover = () => void refresh();
    window.addEventListener('focus', recover);
    return () => { clearInterval(timer); window.removeEventListener('focus', recover); };
  }, [refresh, identity, enabled]);

  const completePurchase = useCallback(async (operationId: string) => {
    const operation = await creditsApi<{ status: string }>(`operations/${operationId}`);
    if (operation.status !== 'credited') throw new Error('Payment is still being confirmed');
    mutationGenRef.current += 1;
    await refresh();
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

  const claimPromo = useCallback(async () => {
    if (!enabled) throw new Error('Connect your account first');
    mutationGenRef.current += 1;
    const rawBalance = await creditsApi<CreditBalance>('promo/claim', {}, crypto.randomUUID());
    if (latest.current.identity !== identity) throw new Error('The account changed');
    const balance: CreditBalance = {
      ...rawBalance,
      packs: rawBalance.packs ?? [],
      paypalClientId: rawBalance.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
    };
    if (latest.current.owner) {
      writeCachedCredits(latest.current.owner, balance);
    }
    setState({ identity, owner: latest.current.owner, balance, error: null });
  }, [enabled, identity]);

  return {
    owner,
    authToken,
    enabled,
    balance: current.balance,
    error: current.error,
    loading,
    refresh,
    claimPromo,
    completePurchase,
  };
}
