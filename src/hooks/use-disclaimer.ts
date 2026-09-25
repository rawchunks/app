import { useQuery } from "@tanstack/react-query";

import { sdk } from "@/lib/sdk";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { DISCLAIMER_POLICY_VERSION, DISCLAIMER_TYPE } from "@/components/disclaimer";

export function useDisclaimerConsent() {
  const { userAddress: activeAddress } = useSelectedUserAddress();

  const query = useQuery({
    queryKey: ["user-consent", activeAddress, DISCLAIMER_POLICY_VERSION],
    queryFn: async () => {
      if (!activeAddress) return { consented: false, record: null };
      return sdk.user.getConsent(activeAddress, {
        disclaimerType: DISCLAIMER_TYPE,
        policyVersion: DISCLAIMER_POLICY_VERSION,
      });
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
