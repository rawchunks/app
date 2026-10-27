import { useQuery } from "@tanstack/react-query";

import { sdk } from "@/lib/sdk";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { DISCLAIMER_POLICY_VERSION, DISCLAIMER_TYPE } from "@/components/disclaimer";

export function useDisclaimerConsent() {
  const { accountId, evmAddress, userAddress } = useSelectedUserAddress();
  const activeAddress = accountId ?? evmAddress?.toLowerCase() ?? userAddress ?? null;

  const query = useQuery({
    queryKey: ["user-consent", activeAddress, DISCLAIMER_POLICY_VERSION],
    queryFn: async () => {
      if (!activeAddress) return { consented: false, record: null };
      const params = new URLSearchParams({ type: DISCLAIMER_TYPE, version: DISCLAIMER_POLICY_VERSION });
      const response = await sdk.fetch(`/api/user/consent/${encodeURIComponent(activeAddress)}?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Could not check consent (HTTP ${response.status}).`);
      return result;
    },
    enabled: Boolean(activeAddress),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  return {
    hasConsented: Boolean(query.data?.consented),
    consentRecord: query.data?.record ?? null,
    isLoading: query.isLoading && Boolean(activeAddress),
    refetch: query.refetch,
  };
}
