import { useActiveAccount, useActiveWallet } from "thirdweb/react";

export function useWalletAccount() {
    const account = useActiveAccount();
    const wallet = useActiveWallet();

    return {
        isConnected: !!account,
        address: account?.address,
        account,
        wallet,
    };
}
