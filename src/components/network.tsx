import { useRef, useState } from 'react';
import { useGuideOwner, prepareViews } from './guide/owners';
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

  const [open, setOpen] = useState(false);
  const openRef = useRef(open); openRef.current = open;
  useGuideOwner({ id: 'network', scope: selectedNetwork, handles: step => step.id === 'F5', prepare: () => ({ ...prepareViews({ open }, () => ({ open: openRef.current }), { open: setOpen }, { open: true }), target: 'funding.network-menu', focus: '[aria-selected="true"]' }) });
  const current = getChainByNetworkId(selectedNetwork);

  return (
    <Select open={open} onOpenChange={setOpen} value={selectedNetwork} onValueChange={(value) => setSelectedNetwork(value as NetworkId)}>
      <SelectTrigger className={cn("account-network-trigger", className)} aria-label="Payment network">
        <NetworkGlyph network={selectedNetwork} name={current?.name} />
        {current?.name ? <span className="account-network-name">{current.name}</span> : null}
      </SelectTrigger>
      <SelectContent data-guide="funding.network-menu" className="account-network-content">
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
