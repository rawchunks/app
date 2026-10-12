import React, { useState, useEffect } from 'react';
import { Glitch } from '../components/glitch';
import { Button } from '../components/button';
import { Badge } from '../components/badge';
import { store } from '../lib/store';
import { useSongs } from '../hooks/use-songs';
import { Licenses } from '../components/licenses';
import { groupSongs } from '../lib/versions';
import { Versions } from '../components/versions';
import { useSession, promptSessionModal } from '../components/session';
import { useSelectedUserAddress } from '../hooks/use-address';
import { toast } from 'sonner';

export interface Props {
  className?: string;
  style?: React.CSSProperties;
}

export const Market: React.FC<Props> = ({ className = '', style = {} }) => {
  const [playing, setPlaying] = useState(() => ({ id: store.getState().activeSong?.id, active: store.getState().isPlaying }));
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const { data: publicSongs = [], isPending, error } = useSongs();
  const { session } = useSession();
  const { userAddress } = useSelectedUserAddress();

  useEffect(() => {
    return store.subscribe(state => {
      setPlaying(current => current.id === state.activeSong?.id && current.active === state.isPlaying
        ? current : { id: state.activeSong?.id, active: state.isPlaying });
    });
  }, []);

  const displayedSongs = filterTag
    ? publicSongs.filter((s) => s.tags.includes(filterTag))
    : publicSongs;

  return (
    <div className={`market-container ${className}`} style={style}>
      {/* Header */}
      <div className="market-header">
        <div className="market-header-left">
          <Glitch text="AUDIO_MARKET" className="market-title-text" />
          <div className="market-subtitle">
            STREAM TRACKS • {publicSongs.length} PUBLIC TRACKS
          </div>
        </div>

        {filterTag && (
          <Button variant="ghost" size="sm" onClick={() => setFilterTag(null)}>
            CLEAR FILTER: {filterTag}
          </Button>
        )}
      </div>

      {/* Catalog Grid */}
      <div className="market-grid panel scrollable">
        {error && publicSongs.length > 0 && <div role="alert">{error.message}</div>}
        {displayedSongs.length === 0 ? (
          <div className="market-empty">
            <span className="market-empty-title">{error ? 'COULD NOT LOAD MARKET' : isPending ? 'LOADING PUBLIC TRACKS' : filterTag ? 'NO MATCHING TRACKS' : 'NO PUBLIC TRACKS IN MARKET'}</span>
            <span className="market-empty-desc">
              {error?.message ?? (isPending ? 'Loading public songs…' : filterTag ? 'Clear the filter to see all public tracks.' : 'Creators can make their generated tracks public from /my-page to list them here.')}
            </span>
          </div>
        ) : (
          groupSongs(displayedSongs).map((versions) => {
            const family = versions[0].family ?? versions[0].id;
            const song = versions.find(song => song.id === selected[family]) ?? versions[0];
            const isPlayingThis = playing.active && playing.id === song.id;

            return (
              <div
                key={family}
                className={`market-card ${isPlayingThis ? 'playing' : ''}`}
              >
                {/* Track Title & Tags */}
                <div>
                  <div className="market-card-title">{song.title}</div>
                  <Versions songs={versions} selected={song.id} onSelect={version => {
                    setSelected(current => ({ ...current, [family]: version.id }));
                    if (versions.some(item => item.id === playing.id)) store.setActiveSong(version);
                  }} />
                  <div className="market-card-creator">
                    CREATOR: {song.creator}
                  </div>
                  <div className="market-card-tags">
                    {song.tags.map((t) => (
                      <Badge
                        key={t}
                        variant={filterTag === t ? 'primary' : 'muted'}
                        onClick={() => setFilterTag(t)}
                        clickable
                      >
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Pricing Box */}
                <div className="market-pricing-box">
                  <div className="market-price-item">
                    <span className="market-price-label">STREAM RATE</span>
                    <span className="market-price-val market-price-val-stream">
                      ${song.stream_price.toFixed(2)}
                      <span className="market-price-unit"> / min</span>
                    </span>
                  </div>
                  {!song.source && <div className="market-price-item">
                    <span className="market-price-label">LICENSE</span>
                    <span className="market-price-val market-price-val-license">
                      ${song.license_price.toFixed(2)}
                    </span>
                  </div>}
                </div>

                {/* Actions */}
                <div className="market-card-actions">
                  <Button
                    variant={isPlayingThis ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => {
                      if (isPlayingThis) {
                        store.setPlaying(false);
                      } else {
                        const isCreator = Boolean(
                          userAddress && song.creator && (
                            userAddress.toLowerCase() === song.creator.toLowerCase()
                          )
                        );
                        if (!isCreator && !session.active) {
                          toast.error('Active session required to stream music. Please create a session.');
                          promptSessionModal();
                          return;
                        }
                        store.setActiveSong(song);
                        store.setPlaying(true);
                      }
                    }}
                  >
                    {isPlayingThis ? 'PAUSE' : 'STREAM'}
                  </Button>
                  <Licenses key={song.id} song={song} placement="market" />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
