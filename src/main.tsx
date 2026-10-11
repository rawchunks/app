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
