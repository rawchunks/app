import { cn } from "@/lib/utils";
import { useChain, NetworkGlyph } from "@/contexts/Network";
import type { NetworkId } from "@compose-market/sdk/chains";
import { useMultiChainBalance } from "@/hooks/use-multichain";
import { useSelectedUserAddress } from "@/hooks/use-address";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

interface NetworkSelectorProps {
  className?: string;
}

export function NetworkSelector({ className }: NetworkSelectorProps) {
  const { evmAddress, svmAddress } = useSelectedUserAddress();
  const { selectedNetwork, setSelectedNetwork, chains, getChainByNetworkId } = useChain();
  const { data: balances } = useMultiChainBalance({ evmAddress, svmAddress });

  const current = getChainByNetworkId(selectedNetwork);

  return (
    <Select value={selectedNetwork} onValueChange={(value) => setSelectedNetwork(value as NetworkId)}>
      <SelectTrigger className={cn("account-network-trigger", className)} aria-label="Payment network">
        <NetworkGlyph network={selectedNetwork} name={current?.name} />
        {current?.name ? <span className="account-network-name">{current.name}</span> : null}
      </SelectTrigger>
      <SelectContent className="account-network-content">
        {chains.map((network) => {
          const balance = balances?.find((b) => b.network === network.network);
          return (
            <SelectItem key={network.network} value={network.network}>
              <NetworkGlyph network={network.network} name={network.name} />
              <b>{network.name}</b>
              {balance ? <span>${balance.formatted}</span> : null}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
