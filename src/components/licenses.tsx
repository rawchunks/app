import { useState } from 'react';
import { Tag, GitFork } from 'lucide-react';
import { Button } from './button';
import { Badge } from './badge';
import { Tooltip } from './daw/Tooltip';
import { weiToUsdc } from '../lib/chains';
import { Modal } from './modal';
import { useLicense } from '../hooks/use-license';
import type { Song } from '../lib/schema';

export function Licenses({
  song,
  onEditSong,
  placement,
  compact = false,
}: {
  song: Song;
  onEditSong?: (song: Song) => void;
  placement: 'market' | 'mypage';
  compact?: boolean;
}) {
  const { data, buy, remix, pending, error, sold, salesError } = useLicense(song, onEditSong, placement === 'mypage');
  const [confirm, setConfirm] = useState(false);

  if (song.source) {
    return (
      <Tooltip title="Remix Track" description="This song is derived from another work">
        <Badge variant="secondary">
          <GitFork size={10} style={{ marginRight: 3 }} />
          REMIX
        </Badge>
      </Tooltip>
    );
  }

  return (
    <>
      {placement === 'mypage' && (
        <Tooltip title="Licenses Sold" description={(salesError ?? error)?.message}>
          <Badge variant={sold ? 'secondary' : 'muted'}>
            {sold !== undefined ? `${sold} SOLD` : !song.chain_song_id ? '0 SOLD' : salesError || error ? 'SALES UNAVAILABLE' : 'LOADING SALES'}
          </Badge>
        </Tooltip>
      )}

      {placement === 'market' && !data?.owned && (
        <Tooltip
          title="Buy License"
          description={
            pending
              ? 'Confirming purchase…'
              : (error?.message || `$${(data ? weiToUsdc(data.price.toString()) : song.license_price).toFixed(2)} • Stems & commercial remix rights`)
          }
        >
          <Button
            variant="accent"
            size="sm"
            onClick={() => setConfirm(true)}
            disabled={pending || Boolean(error) || !data || !data.available || data.remaining === 0n}
            aria-label="Buy License"
            className={compact ? 'market-btn-icon' : ''}
          >
            <Tag size={13} />
            {!compact && <span>{pending ? 'CONFIRMING…' : 'BUY LICENSE'}</span>}
          </Button>
        </Tooltip>
      )}

      {data?.owned && (
        <Tooltip title="Remix in Studio" description="You own this license. Open in Studio to create a remix">
          <Button
            variant="accent"
            size="sm"
            onClick={() => void remix()}
            disabled={pending || Boolean(error)}
            aria-label="Remix Song"
            className={compact ? 'market-btn-icon' : ''}
          >
            <GitFork size={13} />
            {!compact && <span>{pending ? 'OPENING…' : 'REMIX'}</span>}
          </Button>
        </Tooltip>
      )}

      <Modal isOpen={confirm} onClose={() => setConfirm(false)} title="BUY COMMERCIAL LICENSE" maxWidth="420px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 'var(--font-md)', fontWeight: 700, color: 'var(--text)' }}>
            {song.title}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.4)', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 2 }}>
            <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-dim)' }}>PRICE</span>
            <span style={{ fontSize: 'var(--font-md)', fontWeight: 900, color: 'var(--accent)' }}>
              ${data ? weiToUsdc(data.price.toString()).toFixed(2) : song.license_price.toFixed(2)} USDC
            </span>
          </div>
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Purchasing this commercial license grants stem access and the right to create minted derivatives & remixes.
          </div>
          <Button
            variant="accent"
            size="md"
            disabled={pending || !data}
            onClick={() => {
              setConfirm(false);
              void buy();
            }}
          >
            CONFIRM PURCHASE
          </Button>
        </div>
      </Modal>
    </>
  );
}

