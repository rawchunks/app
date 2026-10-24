import { cn } from "@/lib/utils";
import { useChain } from "@/contexts/Network";
import type { NetworkId } from "@compose-market/sdk/chains";
import { useMultiChainBalance } from "@/hooks/use-multichain";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { NetworkGlyph } from "@/contexts/Network";
import { Tooltip } from "@/components/daw/Tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

interface NetworkSelectorProps {
  className?: string;
  bare?: boolean;
}

export function NetworkSelector({ className, bare = false }: NetworkSelectorProps) {
  const { evmAddress, svmAddress } = useSelectedUserAddress();
  const { selectedNetwork, setSelectedNetwork, chains, getChainByNetworkId } = useChain();
  const { data: balances } = useMultiChainBalance({ evmAddress, svmAddress });

  const current = getChainByNetworkId(selectedNetwork);
  const currentBalance = balances?.find((b) => b.network === selectedNetwork);

  const trigger = (
    <SelectTrigger bare={bare} data-guide="network" className={cn(!bare && "header-network-trigger", className)} aria-label="Network">
      <NetworkGlyph network={selectedNetwork} name={current?.name} />
      {!bare && current?.name ? <span className="network-trigger-name">{current.name}</span> : null}
    </SelectTrigger>
  );

  return (
    <Select value={selectedNetwork} onValueChange={(value) => setSelectedNetwork(value as NetworkId)}>
      {bare ? (
        trigger
      ) : (
        <Tooltip
          title={current?.name ? `NETWORK // ${current.name.toUpperCase()}` : "SELECT NETWORK"}
          description={currentBalance ? `Balance: $${currentBalance.formatted}` : "Switch active payment chain"}
          position="bottom"
        >
          {trigger}
        </Tooltip>
      )}
      <SelectContent className="header-network-content">
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

