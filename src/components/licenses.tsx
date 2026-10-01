import { useState } from 'react';
import { Button } from './button';
import { Badge } from './badge';
import { Tooltip } from './daw/Tooltip';
import { weiToUsdc } from '../lib/chains';
import { Modal } from './modal';
import { useLicense } from '../hooks/use-license';
import type { Song } from '../lib/schema';

export function Licenses({song, onEditSong, placement}: {song:Song;onEditSong?:(song:Song)=>void;placement:'market'|'mypage'}) {
  const {data,buy,remix,pending,error,sold,salesError} = useLicense(song,onEditSong,placement === 'mypage');
  const [confirm,setConfirm] = useState(false);
  if (song.source) return <Badge variant="secondary">REMIX</Badge>;
  return <>
    {placement === 'mypage' && <Tooltip title="Licenses sold" description={(salesError ?? error)?.message}><Badge variant={sold ? 'secondary' : 'muted'}>
      {sold !== undefined ? `${sold} SOLD` : !song.chain_song_id ? '0 SOLD' : salesError || error ? 'SALES UNAVAILABLE' : 'LOADING SALES'}
    </Badge></Tooltip>}
    {placement === 'market' && !data?.owned && <Button variant="accent" size="sm" onClick={() => setConfirm(true)} disabled={pending || Boolean(error) || !data || !data.available || data.remaining === 0n} title={error?.message}>
      {pending ? 'CONFIRMING…' : 'BUY LICENSE'}
    </Button>}
    {placement === 'mypage' && data?.owned && <Button variant="accent" size="sm" onClick={() => void remix()} disabled={pending || Boolean(error)} title={error?.message}>{pending ? 'OPENING…' : 'REMIX'}</Button>}
    <Modal isOpen={confirm} onClose={() => setConfirm(false)} title="BUY LICENSE" maxWidth="420px">
      <p>{song.title}</p>
      <p>License: ${data ? weiToUsdc(data.price.toString()).toFixed(2) : song.license_price.toFixed(2)}</p>
      <p>Use this song to create your own remixes. Each remix is minted when made public or downloaded.</p>
      <Button variant="accent" disabled={pending || !data} onClick={() => {setConfirm(false);void buy();}}>CONFIRM</Button>
    </Modal>
  </>;
}
