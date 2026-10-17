if (typeof window !== 'undefined') {
  (window as any).TONE_SILENCE_LOGGING = true;

  // Thirdweb's InAppWebConnector unconditionally constructs InAppWalletIframeCommunicator
  // for legacy 2022 sharded wallets even when using modern EnclaveWallets (passkey/OAuth/email).
  // Appending that cross-origin <iframe id="thirdweb-in-app-wallet-iframe"> triggers a
  // fetchpriority="high" request and causes browser extensions with all_frames: true
  // (e.g. MetaMask contentscript.js) to re-inject and emit MaxListenersExceededWarning /
  // ObjectMultiplex warnings a second time after React mounts.
  const detachedThirdwebIframes = new Map<string, HTMLElement>();
  const origAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function <T extends Node>(newChild: T): T {
    if (
      newChild instanceof HTMLIFrameElement &&
      typeof newChild.id === 'string' &&
      newChild.id.startsWith('thirdweb-in-app-wallet-iframe')
    ) {
      detachedThirdwebIframes.set(newChild.id, newChild);
      return newChild;
    }
    return origAppendChild.call(this, newChild) as T;
  };
  const origGetElementById = Document.prototype.getElementById;
  Document.prototype.getElementById = function (elementId: string): HTMLElement | null {
    if (typeof elementId === 'string' && detachedThirdwebIframes.has(elementId)) {
      return detachedThirdwebIframes.get(elementId) ?? null;
    }
    return origGetElementById.call(this, elementId);
  };
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThirdwebProvider } from 'thirdweb/react';
import { ChainProvider } from '@/contexts/Network';
import { SessionProvider } from '@/components/session';
import { Toaster } from 'sonner';
import { App } from './App';
import './lib/daw/store';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThirdwebProvider>
        <ChainProvider>
          <SessionProvider>
            <App />
            <Toaster position="bottom-right" theme="dark" />
          </SessionProvider>
        </ChainProvider>
      </ThirdwebProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
