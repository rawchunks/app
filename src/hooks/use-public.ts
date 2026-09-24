import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useActiveAccount } from 'thirdweb/react';
import { toast } from 'sonner';
import { useSelectedUserAddress } from './use-address';
import { useMint } from './use-mint';
import { sdk } from '../lib/sdk';
import { store } from '../lib/store';
import type { Song } from '../lib/schema';

export function usePublic() {
  const queryClient = useQueryClient();
  const account = useActiveAccount();
  const { userAddress } = useSelectedUserAddress();
  const { ensure } = useMint();
  const [pending, setPending] = useState<string | null>(null);

  const toggle = async (song: Song) => {
    if (pending) return;
    if (!account || !userAddress) { toast.error('Connect your wallet'); return; }
    setPending(song.id);
    try {
      const current = song.public ? song : await ensure(song);
      const updates: Partial<Song> = { public: !current.public };
      const response = await sdk.fetch(`/api/songs/${encodeURIComponent(song.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save song visibility');
      store.updateSong(song.id, updates);
      await queryClient.invalidateQueries({ queryKey: ['songs', 'public'] });
      toast.success(updates.public ? 'Song is public' : 'Song is private');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update song visibility');
    } finally { setPending(null); }
  };
  return { toggle, pending };
}
