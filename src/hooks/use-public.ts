import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useActiveAccount } from 'thirdweb/react';
import { toast } from 'sonner';
import { useSelectedUserAddress } from './use-address';
import { useMint } from './use-mint';
import { api } from '../lib/api';
import { store } from '../lib/store';
import type { Song } from '../lib/schema';

export function usePublic() {
  const queryClient = useQueryClient();
  const account = useActiveAccount();
  const { userAddress } = useSelectedUserAddress();
  const { ensure } = useMint();
  const [pending, setPending] = useState<string | null>(null);

  const toggle = async (song: Song): Promise<Song | null> => {
    if (pending) return null;
    if (!account || !userAddress) { toast.error('Connect your wallet'); return null; }
    setPending(song.id);
    try {
      const current = song.public ? song : await ensure(song);
      const updates: Partial<Song> = { public: !current.public };
      const response = await api.fetch(`/api/songs/${encodeURIComponent(song.id)}`, {
        userAddress,
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save song visibility');
      const updatedSong: Song = {
        ...current,
        ...updates,
        ...(result?.creator ? { creator: result.creator } : {}),
        ...(result?.published_at ? { published_at: result.published_at } : {}),
      };
      store.updateSong(song.id, updatedSong);
      await queryClient.invalidateQueries({ queryKey: ['songs', 'public'] });
      await queryClient.invalidateQueries({ queryKey: ['market', 'folds'] });
      await queryClient.invalidateQueries({ queryKey: ['songs', 'paginated'] });
      toast.success(updates.public ? 'Song is public' : 'Song is private');
      return updatedSong;
    } catch (error) {
      console.error(error);
      toast.error(song.public ? (error instanceof Error ? error.message : 'Could not update song visibility') : 'Publication failed. Changed your Network, or try again later.');
      return null;
    } finally { setPending(null); }
  };
  return { toggle, pending };
}
