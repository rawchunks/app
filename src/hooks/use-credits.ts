import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveWallet, useAdminWallet } from 'thirdweb/react';
import { useSelectedUserAddress } from './use-address';
import { readCachedCredits, readCachedPayPalClientId, writeCachedCredits, writeCachedPayPalClientId } from '../lib/cache';
import { creditsApi, DEFAULT_PAYPAL_CLIENT_ID, purchaseCacheKey, zeroCredits, type CreditBalance } from '../lib/credits';

export function useCreditAccount() {
  const admin = useAdminWallet(), active = useActiveWallet();
  const wallet = admin ?? active;
  const { userAddress, readAddress, accountId } = useSelectedUserAddress();
  const effectiveAddress = userAddress ?? readAddress ?? null;
  const owner = accountId ?? effectiveAddress?.toLowerCase() ?? null;
  const authToken = wallet?.getAuthToken?.() ?? null;
  const identity = `${owner ?? 'anon'}:${effectiveAddress ?? ''}`;
  const latest = useRef({ identity, owner, effectiveAddress, authToken });
  latest.current = { identity, owner, effectiveAddress, authToken };
  const mutationGenRef = useRef(0);

  const [state, setState] = useState<{ identity: string; owner: string | null; balance: CreditBalance; error: string | null }>(() => {
    const initialOwner = owner;
    const cachedSnap = readCachedCredits(initialOwner);
    const cachedPayPal = readCachedPayPalClientId();
    const initialBalance: CreditBalance = cachedSnap?.balance
      ? {
          ...cachedSnap.balance,
          promo: cachedSnap.balance.promo ?? cachedPayPal?.promo,
          packs: cachedSnap.balance.packs?.length ? cachedSnap.balance.packs : (cachedPayPal?.packs ?? []),
          paypalClientId: cachedSnap.balance.paypalClientId || cachedPayPal?.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
          environment: cachedSnap.balance.environment || cachedPayPal?.environment || 'sandbox',
        }
      : {
          ...zeroCredits,
          promo: cachedPayPal?.promo,
          packs: cachedPayPal?.packs ?? [],
          paypalClientId: cachedPayPal?.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
          environment: cachedPayPal?.environment || 'sandbox',
        };
    return {
      identity,
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
              promo: cachedSnapForOwner.balance.promo ?? cachedPayPal?.promo,
              packs: cachedSnapForOwner.balance.packs?.length ? cachedSnapForOwner.balance.packs : (state.balance.packs?.length ? state.balance.packs : (cachedPayPal?.packs ?? [])),
              paypalClientId: cachedSnapForOwner.balance.paypalClientId || state.balance.paypalClientId || cachedPayPal?.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
              environment: cachedSnapForOwner.balance.environment || state.balance.environment || cachedPayPal?.environment || 'sandbox',
            }
          : {
              ...zeroCredits,
              promo: cachedPayPal?.promo ?? (owner === null ? state.balance.promo : zeroCredits.promo),
              packs: state.balance.packs?.length ? state.balance.packs : (cachedPayPal?.packs ?? []),
              paypalClientId: state.balance.paypalClientId || cachedPayPal?.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
              environment: state.balance.environment || cachedPayPal?.environment || 'sandbox',
            },
        error: null,
      };

  const [loading, setLoading] = useState(false);
  const enabled = Boolean(owner && effectiveAddress);

  useEffect(() => {
    if (enabled) return;
    let cancelled = false;
    setLoading(true);
    void creditsApi<Partial<CreditBalance>>('promo')
      .then((data) => {
        if (cancelled || latest.current.effectiveAddress !== null) return;
        const paypalClientId = data.paypalClientId || readCachedPayPalClientId()?.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID;
        const environment = data.environment || readCachedPayPalClientId()?.environment || 'sandbox';
        writeCachedPayPalClientId(paypalClientId, environment, data.packs, data.promo);
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
        if (!cancelled && latest.current.effectiveAddress === null) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const refresh = useCallback(async () => {
    const { effectiveAddress: reqAddr, authToken: reqToken, owner: reqOwner } = latest.current;
    if (!reqOwner || !reqAddr) return;
    const gen = mutationGenRef.current;
    try {
      const rawBalance = await creditsApi<CreditBalance>('balance', undefined, undefined, {
        userAddress: reqAddr,
        authToken: reqToken,
      });
      if (latest.current.identity !== identity || mutationGenRef.current !== gen) return;
      const balance: CreditBalance = {
        ...rawBalance,
        packs: rawBalance.packs ?? [],
        paypalClientId: rawBalance.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
      };
      if (latest.current.owner) {
        writeCachedCredits(latest.current.owner, balance);
      }
      writeCachedPayPalClientId(
        balance.paypalClientId,
        balance.environment || 'sandbox',
        balance.packs,
        balance.promo,
      );
      setState({ identity, owner: latest.current.owner, balance, error: null });
    } catch (error) {
      if (latest.current.identity === identity && mutationGenRef.current === gen) {
        const fallbackConfig = readCachedPayPalClientId();
        setState(previous => ({
          balance: previous.owner === latest.current.owner
            ? previous.balance
            : {
                ...zeroCredits,
                promo: fallbackConfig?.promo ?? previous.balance.promo,
                packs: previous.balance.packs?.length ? previous.balance.packs : (fallbackConfig?.packs ?? []),
                paypalClientId: previous.balance.paypalClientId || fallbackConfig?.paypalClientId || DEFAULT_PAYPAL_CLIENT_ID,
                environment: previous.balance.environment || fallbackConfig?.environment || 'sandbox',
              },
          identity,
          owner: latest.current.owner,
          error: error instanceof Error ? error.message : 'Credits unavailable',
        }));
      }
    }
  }, [identity]);

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
    const { effectiveAddress: reqAddr, authToken: reqToken } = latest.current;
    const operation = await creditsApi<{ status: string }>(`operations/${operationId}`, undefined, undefined, {
      userAddress: reqAddr,
      authToken: reqToken,
    });
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
    const { effectiveAddress: reqAddr, authToken: reqToken } = latest.current;
    const liveToken = wallet?.getAuthToken?.() ?? reqToken;
    if (!enabled || !reqAddr) throw new Error('Connect your account first');
    if (!liveToken) throw new Error('A verified email or social account is required to claim Campaign Credits');
    mutationGenRef.current += 1;
    const rawBalance = await creditsApi<CreditBalance>('promo/claim', {}, crypto.randomUUID(), {
      userAddress: reqAddr,
      authToken: liveToken,
    });
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
  }, [enabled, identity, wallet]);

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
