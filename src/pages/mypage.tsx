import { sdk } from '@/lib/sdk';
import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Pencil, ChevronDown, Copy, Check, Disc3, Mic2, Music, Volume2, User } from 'lucide-react';
import { Glitch } from '../components/glitch';
import { Button } from '../components/button';
import { Badge } from '../components/badge';
import { store, State } from '../lib/store';
import { Song, Album } from '../lib/schema';
import { useSelectedUserAddress } from '../hooks/use-address';
import { usePublic } from '../hooks/use-public';
import { useMint } from '../hooks/use-mint';
import { useProfile } from '../hooks/use-profile';
import { useSongs } from '../hooks/use-songs';
import { useLicensedSongs } from '../hooks/use-license';
import { useVoices, voiceAvailability, voiceStatus } from '../hooks/use-voices';
import { ProfileModal } from '../components/profile-modal';
import { readSongs, writeSongs } from '../lib/cache';
import { groupSongs } from '../lib/versions';
import { Licenses } from '../components/licenses';
import { Versions } from '../components/versions';

export interface Props {
  onEditSong: (song: Song) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Mypage: React.FC<Props> = ({ onEditSong, className = '', style = {} }) => {
  const { readAddress, isReconnecting } = useSelectedUserAddress();

  const [state, setState] = useState<State>(() => ({
    ...store.getState(),
    songs: readAddress ? readSongs(readAddress) ?? store.getState().songs : store.getState().songs,
  }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const download = useRef<{ link: HTMLAnchorElement; url: string } | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});

  // 4 Sections Collapsible States
  const [songsOpen, setSongsOpen] = useState(true);
  const [licensesOpen, setLicensesOpen] = useState(true);
  const [albumsOpen, setAlbumsOpen] = useState(true);
  const [voicesOpen, setVoicesOpen] = useState(true);

  // Profile Modal State
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Albums & Voices Data
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(false);

  const activeAddress = readAddress;
  const { data: publicSongs = [], error: publicSongsError } = useSongs();
  const licensed = useLicensedSongs(publicSongs);
  const { voices, loading: loadingVoices, error: voicesError, refresh: refreshVoices } = useVoices(activeAddress);
  const { nickname, avatar } = useProfile(activeAddress);
  const formattedAddress = activeAddress ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}` : '';
  const displayName = nickname || formattedAddress || '0x...';
  const { toggle: togglePublic, pending: publicPending } = usePublic();
  const { ensure: ensureMint, pending: mintPending } = useMint();

  useEffect(() => () => {
    if (download.current) {
      download.current.link.remove();
      URL.revokeObjectURL(download.current.url);
    }
  }, []);

  useEffect(() => {
    const cached = activeAddress ? readSongs(activeAddress) : null;
    if (cached) store.setSongs(cached);
    let songs = store.getState().songs;
    return store.subscribe(next => {
      setState(next);
      if (next.songs !== songs) {
        songs = next.songs;
        if (activeAddress) writeSongs(songs, activeAddress);
      }
    });
  }, [activeAddress]);

  // Fetch Songs
  useEffect(() => {
    if (!activeAddress) { setLoading(false); return; }
    let current = true;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const res = await sdk.fetch(`/api/songs?creator=${encodeURIComponent(activeAddress)}`, { userAddress: activeAddress });
        const dbSongs = await res.json();
        if (!current) return;
        if (!res.ok) throw new Error(dbSongs?.error || 'Could not load your songs');
        if (!Array.isArray(dbSongs)) throw new Error('Invalid song collection');
        const mapped: Song[] = dbSongs.map((s: any) => ({
          ...s,
          tags: s.tags ?? [],
          public: s.public ?? false,
          image: s.image || '/hero.png',
          licenses: s.licenses ?? 0,
          stream_price: Number(s.stream_price),
          license_price: Number(s.license_price),
          url: s.url ?? '',
        }));
        store.setSongs(mapped);
      } catch (err) {
        if (current) setError(err instanceof Error ? err.message : 'Could not load your songs');
      } finally {
        if (current) setLoading(false);
      }
    };
    void load();
    return () => { current = false; };
  }, [activeAddress]);

  // Fetch Albums
  useEffect(() => {
    if (!activeAddress) {
      setAlbums([]);
      return;
    }
    let current = true;
    setLoadingAlbums(true);

    void (async () => {
      try {
        const res = await sdk.fetch(`/api/albums?creator=${encodeURIComponent(activeAddress)}`, { userAddress: activeAddress });
        const data = await res.json();
        if (current && Array.isArray(data)) {
          setAlbums(data);
        }
      } catch (err) {
        console.error('Failed to load albums', err);
      } finally {
        if (current) setLoadingAlbums(false);
      }
    })();

    return () => { current = false; };
  }, [activeAddress]);

  const copyAddress = () => {
    if (!activeAddress) return;
    navigator.clipboard.writeText(activeAddress);
    setCopied(true);
    toast.success('Address copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async (song: Song) => {
    if (downloading) return;
    setMenuOpenId(null);
    if (!song.url) {
      toast.error('No audio file available for this song.');
      return;
    }
    setDownloading(song.id);
    try {
      const minted = await ensureMint(song);
      const res = await fetch(minted.url);
      if (!res.ok) throw new Error('Could not download the audio');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${song.title.replace(/\s+/g, '_').toLowerCase()}.wav`;
      if (download.current) {
        download.current.link.remove();
        URL.revokeObjectURL(download.current.url);
      }
      download.current = { link: a, url };
      document.body.appendChild(a);
      a.click();
    } catch (err) {
      console.error('Audio download failed', err);
      toast.error(err instanceof Error ? err.message : 'Could not download the audio');
    } finally { setDownloading(null); }
  };

  const handleDelete = async (id: string) => {
    setMenuOpenId(null);
    try {
      const response = await sdk.fetch(`/api/songs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete the song');
      store.deleteSong(id);
    } catch (err) {
      console.error('Failed to delete song on backend', err);
      toast.error('Could not delete the song');
    }
  };

  return (
    <div className={`mypage-container ${className}`} style={style}>
      {/* Page Header */}
      <div className="mypage-header">
        <div>
          <Glitch text="MY_PAGE" className="mypage-title-text" />
          <div className="mypage-subtitle">
            CREATOR'S PROFILE &bull; AUDIO LICENSING PORTAL
          </div>
        </div>
      </div>

      {/* SECTION (i): Profile Header */}
      <div className="mypage-profile-card">
        <div className="mypage-profile-left">
          {avatar ? (
            <img src={avatar} alt="Profile Avatar" className="mypage-profile-avatar" />
          ) : (
            <div className="mypage-profile-avatar-placeholder">
              <User size={24} />
            </div>
          )}
          <div className="mypage-profile-details">
            <div className="mypage-profile-nickname-row">
              <span className="mypage-profile-nickname">
                {displayName}
              </span>
              <button
                type="button"
                className="mypage-profile-edit-btn"
                onClick={() => setProfileModalOpen(true)}
                title="Edit Profile"
                aria-label="Edit Profile"
              >
                <Pencil size={12} />
              </button>
            </div>
            {activeAddress && (
              <div className="mypage-profile-meta">
                <button
                  type="button"
                  className="mypage-copy-btn"
                  onClick={copyAddress}
                  title="Copy Full Address"
                >
                  <span>{nickname ? formattedAddress : 'COPY ADDRESS'}</span>
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mypage-profile-stats">
          <div className="mypage-profile-stat-box">
            <span className="mypage-profile-stat-val">{state.songs.length}</span>
            <span className="mypage-profile-stat-label">Tracks</span>
          </div>
          <div className="mypage-profile-stat-box">
            <span className="mypage-profile-stat-val">{albums.length}</span>
            <span className="mypage-profile-stat-label">Albums</span>
          </div>
          <div className="mypage-profile-stat-box">
            <span className="mypage-profile-stat-val">{voices.length}</span>
            <span className="mypage-profile-stat-label">Voices</span>
          </div>
        </div>
      </div>

      {/* SECTION (ii): My Songs */}
      <div className="mypage-section">
        <div
          className={`board-section-separator ${!songsOpen ? 'collapsed' : ''}`}
          onClick={() => setSongsOpen(!songsOpen)}
          role="button"
          tabIndex={0}
        >
          <div className="board-section-left">
            <ChevronDown className="board-section-chevron" size={14} />
            <Music size={13} />
            <span>MY SONGS</span>
            <span className="board-section-badge">{state.songs.length}</span>
          </div>
        </div>

        {songsOpen && (
          <div className="mypage-section-body">
            {error && state.songs.length > 0 && <div role="alert">{error}</div>}
            {state.songs.length === 0 ? (
              <div className="mypage-empty">
                <span className="mypage-empty-title">
                  {error ? 'COULD NOT LOAD SONGS' : loading || isReconnecting ? 'LOADING SONGS' : activeAddress ? 'NO SONGS GENERATED YET' : 'CONNECT YOUR WALLET'}
                </span>
                <span className="mypage-empty-desc">
                  {error ?? (loading || isReconnecting ? 'Loading your songs…' : activeAddress ? 'Go to /studio to create your first track.' : 'Connect your wallet to see your songs.')}
                </span>
              </div>
            ) : (
              groupSongs(state.songs).map((versions) => {
                const family = versions[0].family ?? versions[0].id;
                const song = versions.find(s => s.id === selected[family]) ?? versions[0];
                const isPlayingThis = state.isPlaying && state.activeSong?.id === song.id;
                const isMenuOpen = menuOpenId === song.id;

                return (
                  <div
                    key={family}
                    className={`mypage-song-card ${state.activeSong?.id === song.id ? 'active' : ''}`}
                  >
                    {/* Top Row: Playback & Track Info & 3-Dot Menu */}
                    <div className="mypage-card-top">
                      <div className="mypage-card-info">
                        <Button
                          variant={isPlayingThis ? 'primary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            if (isPlayingThis) {
                              store.setPlaying(false);
                            } else {
                              store.setActiveSong(song);
                              store.setPlaying(true);
                            }
                          }}
                        >
                          {isPlayingThis ? 'PAUSE' : 'PLAY'}
                        </Button>

                        <div className="mypage-card-text">
                          <div className="mypage-card-title">
                            {song.title}
                          </div>
                          <Versions
                            songs={versions}
                            selected={song.id}
                            onSelect={version => {
                              setSelected(current => ({ ...current, [family]: version.id }));
                              setMenuOpenId(null);
                              if (versions.some(item => item.id === state.activeSong?.id)) store.setActiveSong(version);
                            }}
                          />
                          <div className="mypage-card-meta">
                            {song.tags.join(' // ')} • {song.duration}s
                          </div>
                        </div>
                      </div>

                      {/* 3-Dot Action Menu */}
                      <div className="mypage-menu-wrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setMenuOpenId(isMenuOpen ? null : song.id)}
                          className="mypage-menu-btn"
                        >
                          •••
                        </Button>

                        {isMenuOpen && (
                          <div className="mypage-menu-dropdown">
                            <button
                              type="button"
                              className="mypage-menu-item mypage-item-edit"
                              onClick={() => {
                                setMenuOpenId(null);
                                onEditSong(song);
                              }}
                            >
                              EDIT
                            </button>
                            <button
                              type="button"
                              className="mypage-menu-item mypage-item-download"
                              disabled={Boolean(mintPending || downloading)}
                              onClick={() => handleDownload(song)}
                            >
                              DOWNLOAD
                            </button>
                            <button
                              type="button"
                              className="mypage-menu-item mypage-item-delete"
                              onClick={() => handleDelete(song.id)}
                            >
                              DELETE
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom Row: Prices, Stats & Public Switch */}
                    <div className="mypage-card-bottom">
                      <div className="mypage-card-pricing">
                        <div>STREAM: <span className="mypage-price-stream">${song.stream_price.toFixed(2)}/min</span></div>
                        {!song.source && <div>LICENSE: <span className="mypage-price-license">${song.license_price.toFixed(2)}</span></div>}
                      </div>

                      <div className="mypage-card-right-tools">
                        <Licenses key={song.id} song={song} onEditSong={onEditSong} placement="mypage" />

                        {/* Public <> Private Toggle */}
                        <div className="mypage-toggle-wrap">
                          <span className="mypage-toggle-label">
                            {song.public ? 'PUBLIC' : 'PRIVATE'}
                          </span>
                          <label className="mypage-toggle-input-wrap">
                            <input
                              type="checkbox"
                              checked={song.public}
                              disabled={Boolean(publicPending)}
                              aria-label="Public song"
                              onChange={() => togglePublic(song)}
                              className="mypage-toggle-checkbox"
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className="mypage-section">
        <div className={`board-section-separator ${!licensesOpen ? 'collapsed' : ''}`} onClick={() => setLicensesOpen(!licensesOpen)} role="button" tabIndex={0}>
          <div className="board-section-left">
            <ChevronDown className="board-section-chevron" size={14} />
            <Music size={13} />
            <span>MY LICENSES</span>
            <span className="board-section-badge">{licensed.songs.length}</span>
          </div>
        </div>
        {licensesOpen && <div className="mypage-section-body">
          {(publicSongsError || licensed.error) && <div role="alert">{(publicSongsError || licensed.error)?.message}</div>}
          {licensed.songs.length === 0 ? <div className="mypage-empty"><span className="mypage-empty-title">{licensed.loading ? 'LOADING LICENSES' : 'NO LICENSES PURCHASED'}</span></div> : licensed.songs.map(song => {
            const playing = state.isPlaying && state.activeSong?.id === song.id;
            return <div key={song.id} className="mypage-song-card">
              <div className="mypage-card-top"><div className="mypage-card-info">
                <Button variant={playing ? 'primary' : 'ghost'} size="sm" onClick={() => {
                  if (playing) store.setPlaying(false);
                  else { store.setActiveSong(song); store.setPlaying(true); }
                }}>{playing ? 'PAUSE' : 'PLAY'}</Button>
                <div className="mypage-card-text"><div className="mypage-card-title">{song.title}</div><div className="mypage-card-meta">{song.duration}s</div></div>
              </div></div>
              <div className="mypage-card-bottom"><div className="mypage-card-right-tools"><Licenses song={song} placement="mypage" onEditSong={onEditSong} /></div></div>
            </div>;
          })}
        </div>}
      </div>

      {/* SECTION (iii): My Albums */}
      <div className="mypage-section">
        <div
          className={`board-section-separator ${!albumsOpen ? 'collapsed' : ''}`}
          onClick={() => setAlbumsOpen(!albumsOpen)}
          role="button"
          tabIndex={0}
        >
          <div className="board-section-left">
            <ChevronDown className="board-section-chevron" size={14} />
            <Disc3 size={13} />
            <span>MY ALBUMS</span>
            <span className="board-section-badge">{albums.length}</span>
          </div>
        </div>

        {albumsOpen && (
          <div className="mypage-section-body">
            {loadingAlbums ? (
              <div className="mypage-empty">
                <span className="mypage-empty-title">LOADING ALBUMS...</span>
              </div>
            ) : albums.length === 0 ? (
              <div className="mypage-empty">
                <span className="mypage-empty-title">NO ALBUMS CREATED YET</span>
                <span className="mypage-empty-desc">Compile songs into an album from the Studio or Editor to publish complete records.</span>
              </div>
            ) : (
              <div className="mypage-grid">
                {albums.map((album) => (
                  <div key={album.id} className="mypage-album-card">
                    {album.cover ? (
                      <img src={album.cover} alt={album.title} className="mypage-album-cover" />
                    ) : (
                      <div className="mypage-album-cover-placeholder">
                        <Disc3 size={32} />
                        <span>NO COVER ART</span>
                      </div>
                    )}
                    <div className="mypage-card-header">
                      <span className="mypage-item-title">{album.title}</span>
                      <Badge variant={album.public ? 'secondary' : 'muted'}>
                        {album.public ? 'PUBLIC' : 'PRIVATE'}
                      </Badge>
                    </div>
                    {album.description && (
                      <p className="mypage-item-desc">{album.description}</p>
                    )}
                    <div className="mypage-item-footer">
                      <span>{new Date(album.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* SECTION (iv): My Voices */}
      <div className="mypage-section">
        <div
          className={`board-section-separator ${!voicesOpen ? 'collapsed' : ''}`}
          onClick={() => setVoicesOpen(!voicesOpen)}
          role="button"
          tabIndex={0}
        >
          <div className="board-section-left">
            <ChevronDown className="board-section-chevron" size={14} />
            <Mic2 size={13} />
            <span>MY VOICES</span>
            <span className="board-section-badge">{voices.length}</span>
          </div>
        </div>

        {voicesOpen && (
          <div className="mypage-section-body">
            {voicesError && <div className="mypage-empty" role="alert">
              <span className="mypage-empty-desc">{voicesError}</span>
              <Button variant="ghost" size="sm" onClick={() => { void refreshVoices(); }}>RETRY</Button>
            </div>}
            {loadingVoices ? (
              <div className="mypage-empty">
                <span className="mypage-empty-title">LOADING VOICES...</span>
              </div>
            ) : !voicesError && voices.length === 0 ? (
              <div className="mypage-empty">
                <span className="mypage-empty-title">NO CUSTOM VOICES</span>
                <span className="mypage-empty-desc">Attach a vocal sample in the Studio or save a voice from one of your songs.</span>
              </div>
            ) : (
              <div className="mypage-grid">
                {voices.map((voice) => (
                  <div key={voice.id} className="mypage-voice-card">
                    <div className="mypage-card-header">
                      <span className="mypage-item-title">{voice.name}</span>
                      <Badge variant={voice.status === 'ready' ? 'secondary' : 'warning'}>
                        {voiceStatus(voice).toUpperCase()}
                      </Badge>
                    </div>
                    <div className="studio-voice-availability" role="status"><span>Fast: {voiceAvailability(voice, 'turbo')}</span><span>Master: {voiceAvailability(voice, 'sft')}</span></div>
                    {(['turbo', 'sft'] as const).map(mode => {
                      const availability = voice.availability[mode];
                      return availability.step != null && ['queued', 'training'].includes(availability.status)
                        ? <div key={mode} className="studio-voice-detail">{mode === 'turbo' ? 'Fast' : 'Master'}: Preparing · {availability.step}{availability.total_steps != null ? ` / ${availability.total_steps}` : ''}</div>
                        : null;
                    })}
                    {(voice.error || voice.availability.turbo.error || voice.availability.sft.error) && <div className="studio-voice-detail" role="alert">{voice.error || voice.availability.turbo.error || voice.availability.sft.error}</div>}
                    {voice.sample_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const audio = new Audio(voice.sample_url!);
                          audio.play().catch(console.error);
                        }}
                      >
                        <Volume2 size={12} />
                        <span>PLAY SAMPLE</span>
                      </Button>
                    )}
                    <div className="mypage-item-footer">
                      <span>{new Date(voice.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Profile Modal */}
      <ProfileModal
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        address={activeAddress}
      />
    </div>
  );
};
