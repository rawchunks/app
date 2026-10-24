import { sdk } from '@/lib/sdk';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Pencil,
  ChevronDown,
  Copy,
  Check,
  Disc3,
  Mic2,
  Music,
  Volume2,
  User,
  RotateCcw,
} from 'lucide-react';
import { Tooltip } from '../components/daw/Tooltip';
import { Glitch } from '../components/glitch';
import { Button } from '../components/button';
import { Badge } from '../components/badge';
import { Card } from '../components/card';
import { store, State } from '../lib/store';
import { Song, Album } from '../lib/schema';
import { useSelectedUserAddress } from '../hooks/use-address';
import { usePublic } from '../hooks/use-public';
import { useMint } from '../hooks/use-mint';
import { useProfile } from '../hooks/use-profile';
import { useSongs } from '../hooks/use-songs';
import { useLicensedSongs } from '../hooks/use-license';
import { useVoices, voiceStatus } from '../hooks/use-voices';
import { ProfileModal } from '../components/profile-modal';
import { EditSongModal } from '../components/edit-song';
import { PublishModal } from '../components/publish';
import { readSongs, writeSongs } from '../lib/cache';
import { groupSongs } from '../lib/versions';
import { useSession, promptSessionModal } from '../components/session';

export interface Props {
  onEditSong: (song: Song) => void;
  className?: string;
}

export const Mypage: React.FC<Props> = ({ onEditSong, className = '' }) => {
  const { readAddress, userAddress, evmAddress, svmAddress, isReconnecting } =
    useSelectedUserAddress();
  const { session } = useSession();

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
  const [songsOpen, setSongsOpen] = useState(() =>
    readAddress ? (readSongs(readAddress)?.length ?? 0) > 0 : true
  );
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [albumsOpen, setAlbumsOpen] = useState(false);
  const [voicesOpen, setVoicesOpen] = useState(false);

  // Track manual user toggle overrides so clicks remain responsive
  const userToggledSongs = useRef(false);
  const userToggledLicenses = useRef(false);
  const userToggledAlbums = useRef(false);
  const userToggledVoices = useRef(false);

  // Modals State
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingDetailsSong, setEditingDetailsSong] = useState<Song | null>(null);
  const [publishConfirmSong, setPublishConfirmSong] = useState<Song | null>(null);
  const [copied, setCopied] = useState(false);

  // Albums & Voices Data
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(false);

  const activeAddress = readAddress;
  const { data: publicSongs = [], error: publicSongsError } = useSongs();
  const licensed = useLicensedSongs(publicSongs);
  const {
    voices,
    loading: loadingVoices,
    error: voicesError,
    refresh: refreshVoices,
  } = useVoices(activeAddress);
  const { nickname, avatar } = useProfile(activeAddress);
  const formattedAddress = activeAddress
    ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}`
    : '';
  const displayName = nickname || formattedAddress || '0x...';
  const { toggle: togglePublic, pending: publicPending } = usePublic();
  const { ensure: ensureMint } = useMint();

  // Fast album lookup map
  const albumsMap = useMemo(() => {
    const map = new Map<string, Album>();
    albums.forEach((a) => map.set(a.id, a));
    return map;
  }, [albums]);

  // Close 3-dot dropdown when clicking outside
  useEffect(() => {
    if (!menuOpenId) return;
    const closeMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest('.mypage-menu-wrap') ||
        target?.closest('.guide-card') ||
        target?.closest('.guide-layer') ||
        target?.closest('.guide-popover') ||
        target?.closest('.guide-overlay-root')
      )
        return;
      setMenuOpenId(null);
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [menuOpenId]);

  useEffect(
    () => () => {
      if (download.current) {
        download.current.link.remove();
        URL.revokeObjectURL(download.current.url);
      }
    },
    []
  );

  useEffect(() => {
    const cached = activeAddress ? readSongs(activeAddress) : null;
    if (cached) store.setSongs(cached);
    let songs = store.getState().songs;
    return store.subscribe((next) => {
      setState(next);
      if (next.songs !== songs) {
        songs = next.songs;
        if (activeAddress) writeSongs(songs, activeAddress);
      }
    });
  }, [activeAddress]);

  // Fetch Songs
  useEffect(() => {
    if (!activeAddress) {
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const res = await sdk.fetch(
          `/api/songs?creator=${encodeURIComponent(activeAddress)}`,
          { userAddress: activeAddress }
        );
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
        if (!userToggledSongs.current) {
          setSongsOpen(mapped.length > 0);
        }
      } catch (err) {
        if (current)
          setError(err instanceof Error ? err.message : 'Could not load your songs');
      } finally {
        if (current) setLoading(false);
      }
    };
    void load();
    return () => {
      current = false;
    };
  }, [activeAddress]);

  // Sync with interactive Guide steps on /mypage
  useEffect(() => {
    const onGuideAction = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.type !== 'mypage-state') return;
      setSongsOpen(true);
      if (detail.openSongMenu) {
        const groups = groupSongs(state.songs);
        if (groups.length > 0) {
          const versions = groups[0];
          const family = versions[0].family ?? versions[0].id;
          const firstSong = versions.find((s) => s.id === selected[family]) ?? versions[0];
          setMenuOpenId(firstSong.id);
        }
      } else if (detail.closeSongMenu) {
        setMenuOpenId(null);
      }
    };
    window.addEventListener('rawchunks:guide-action', onGuideAction);
    return () => window.removeEventListener('rawchunks:guide-action', onGuideAction);
  }, [state.songs, selected]);
  useEffect(() => {
    if (!activeAddress) {
      setAlbums([]);
      return;
    }
    let current = true;
    setLoadingAlbums(true);

    void (async () => {
      try {
        const res = await sdk.fetch(
          `/api/albums?creator=${encodeURIComponent(activeAddress)}`,
          { userAddress: activeAddress }
        );
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

    return () => {
      current = false;
    };
  }, [activeAddress]);

  useEffect(() => {
    if (!licensed.loading && !userToggledLicenses.current) {
      setLicensesOpen(licensed.songs.length > 0);
    }
  }, [licensed.loading, licensed.songs.length]);

  useEffect(() => {
    if (!loadingAlbums && !userToggledAlbums.current) {
      setAlbumsOpen(albums.length > 0);
    }
  }, [loadingAlbums, albums.length]);

  useEffect(() => {
    if (!loadingVoices && !userToggledVoices.current) {
      setVoicesOpen(voices.length > 0);
    }
  }, [loadingVoices, voices.length]);

  const toggleSongs = () => {
    userToggledSongs.current = true;
    setSongsOpen((prev) => !prev);
  };

  const toggleLicenses = () => {
    userToggledLicenses.current = true;
    setLicensesOpen((prev) => !prev);
  };

  const toggleAlbums = () => {
    userToggledAlbums.current = true;
    setAlbumsOpen((prev) => !prev);
  };

  const toggleVoices = () => {
    userToggledVoices.current = true;
    setVoicesOpen((prev) => !prev);
  };

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
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (id: string) => {
    setMenuOpenId(null);
    try {
      const response = await sdk.fetch(`/api/songs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Could not delete the song');
      store.deleteSong(id);
      toast.success('Song deleted successfully');
    } catch (err) {
      console.error('Song deletion failed', err);
      toast.error(err instanceof Error ? err.message : 'Could not delete the song');
    }
  };

  return (
    <div className={`mypage-container ${className}`}>
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
              <span className="mypage-profile-nickname">{displayName}</span>
              <Tooltip title="Edit Profile" description="Update creator nickname and avatar">
                <button
                  type="button"
                  className="mypage-profile-edit-btn"
                  onClick={() => setProfileModalOpen(true)}
                  aria-label="Edit Profile"
                >
                  <Pencil size={12} />
                </button>
              </Tooltip>
            </div>
            {activeAddress && (
              <div className="mypage-profile-meta">
                <Tooltip title="Copy Wallet Address" description={activeAddress}>
                  <button
                    type="button"
                    className="mypage-copy-btn"
                    onClick={copyAddress}
                    aria-label="Copy wallet address"
                  >
                    <span>{formattedAddress}</span>
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                </Tooltip>
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
      <div className="mypage-section" data-guide="mypage-sections">
        <div
          className={`board-section-separator ${!songsOpen ? 'collapsed' : ''}`}
          onClick={toggleSongs}
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
                  {error
                    ? 'COULD NOT LOAD SONGS'
                    : loading || isReconnecting
                      ? 'LOADING SONGS'
                      : activeAddress
                        ? 'NO SONGS GENERATED YET'
                        : 'CONNECT YOUR WALLET'}
                </span>
                <span className="mypage-empty-desc">
                  {error ??
                    (loading || isReconnecting
                      ? 'Loading your songs…'
                      : activeAddress
                        ? 'Go to /studio to create your first track.'
                        : 'Connect your wallet to see your songs.')}
                </span>
              </div>
            ) : (
              <div className="market-grid">
                {groupSongs(state.songs).map((versions) => {
                  const family = versions[0].family ?? versions[0].id;
                  const song = versions.find((s) => s.id === selected[family]) ?? versions[0];
                  const isPlayingThis = state.isPlaying && state.activeSong?.id === song.id;
                  const album = song.album_id ? albumsMap.get(song.album_id) : null;
                  const albumTitle = album?.title || song.album_title || null;
                  const albumCover = album?.cover || null;

                  return (
                    <Card
                      key={family}
                      variant="mypage"
                      song={song}
                      versions={versions}
                      albumTitle={albumTitle}
                      albumCover={albumCover}
                      isPlayingThis={isPlayingThis}
                      onPlayToggle={() => {
                        if (isPlayingThis) {
                          store.setPlaying(false);
                        } else {
                          const isCreator = store.isCreatorOfSong(song, [
                            userAddress,
                            evmAddress,
                            svmAddress,
                            readAddress,
                          ]);
                          if (!isCreator && !session.active) {
                            toast.error(
                              'Active session required to stream music. Please create a session.'
                            );
                            promptSessionModal();
                            return;
                          }
                          store.setActiveSong(song);
                          store.setPlaying(true);
                        }
                      }}
                      onSelectVersion={(v) => {
                        setSelected((current) => ({ ...current, [family]: v.id }));
                        setMenuOpenId(null);
                        if (versions.some((item) => item.id === state.activeSong?.id)) {
                          store.setActiveSong(v);
                        }
                      }}
                      isMenuOpen={menuOpenId === song.id}
                      onToggleMenu={() => setMenuOpenId(menuOpenId === song.id ? null : song.id)}
                      onEditDetails={(s) => {
                        setMenuOpenId(null);
                        setEditingDetailsSong(s);
                      }}
                      onEditInStudio={(s) => {
                        setMenuOpenId(null);
                        onEditSong(s);
                      }}
                      onDownload={handleDownload}
                      onDelete={handleDelete}
                      onPublishClick={(s) => setPublishConfirmSong(s)}
                      publicPending={Boolean(publicPending)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* SECTION (iii): My Licenses */}
      <div className="mypage-section">
        <div
          className={`board-section-separator ${!licensesOpen ? 'collapsed' : ''}`}
          onClick={toggleLicenses}
          role="button"
          tabIndex={0}
        >
          <div className="board-section-left">
            <ChevronDown className="board-section-chevron" size={14} />
            <Music size={13} />
            <span>MY LICENSES</span>
            <span className="board-section-badge">{licensed.songs.length}</span>
          </div>
        </div>
        {licensesOpen && (
          <div className="mypage-section-body">
            {(publicSongsError || licensed.error) && (
              <div role="alert">{(publicSongsError || licensed.error)?.message}</div>
            )}
            {licensed.songs.length === 0 ? (
              <div className="mypage-empty">
                <span className="mypage-empty-title">
                  {licensed.loading ? 'LOADING LICENSES…' : 'NO LICENSES PURCHASED'}
                </span>
                <span className="mypage-empty-desc">
                  {licensed.loading
                    ? 'Retrieving your on-chain licenses…'
                    : 'Licenses you purchase in the Market will appear here for remixing.'}
                </span>
              </div>
            ) : (
              <div className="market-grid">
                {groupSongs(licensed.songs).map((versions) => {
                  const family = versions[0].family ?? versions[0].id;
                  const song = versions.find((s) => s.id === selected[family]) ?? versions[0];
                  const isPlayingThis = state.isPlaying && state.activeSong?.id === song.id;
                  const album = song.album_id ? albumsMap.get(song.album_id) : null;
                  const albumTitle = album?.title || song.album_title || null;
                  const albumCover = album?.cover || null;

                  return (
                    <Card
                      key={family}
                      variant="mypage"
                      song={song}
                      versions={versions}
                      albumTitle={albumTitle}
                      albumCover={albumCover}
                      isPlayingThis={isPlayingThis}
                      onPlayToggle={() => {
                        if (isPlayingThis) {
                          store.setPlaying(false);
                        } else {
                          const isCreator = store.isCreatorOfSong(song, [
                            userAddress,
                            evmAddress,
                            svmAddress,
                            readAddress,
                          ]);
                          if (!isCreator && !session.active) {
                            toast.error(
                              'Active session required to stream music. Please create a session.'
                            );
                            promptSessionModal();
                            return;
                          }
                          store.setActiveSong(song);
                          store.setPlaying(true);
                        }
                      }}
                      onSelectVersion={(v) => {
                        setSelected((cur) => ({ ...cur, [family]: v.id }));
                        if (versions.some((item) => item.id === state.activeSong?.id)) {
                          store.setActiveSong(v);
                        }
                      }}
                      onEditInStudio={onEditSong}
                      onDownload={handleDownload}
                      onDelete={handleDelete}
                      isRemixLicensed={true}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* SECTION (iv): My Albums */}
      <div className="mypage-section">
        <div
          className={`board-section-separator ${!albumsOpen ? 'collapsed' : ''}`}
          onClick={toggleAlbums}
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
                <span className="mypage-empty-desc">
                  Compile songs into an album from the Studio or Editor to publish complete records.
                </span>
              </div>
            ) : (
              <div className="mypage-grid">
                {albums.map((album) => (
                  <div key={album.id} className="mypage-album-card">
                    {album.cover ? (
                      <img src={album.cover} alt={album.title} className="mypage-album-cover" />
                    ) : (
                      <div className="mypage-album-cover-placeholder">
                        <Disc3 size={28} />
                        <span>NO COVER</span>
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

      {/* SECTION (v): My Voices */}
      <div className="mypage-section">
        <div
          className={`board-section-separator ${!voicesOpen ? 'collapsed' : ''}`}
          onClick={toggleVoices}
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
            {voicesError && (
              <div className="mypage-empty" role="alert">
                <span className="mypage-empty-desc">{voicesError}</span>
                <Tooltip title="Retry Loading Voices">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void refreshVoices();
                    }}
                  >
                    <RotateCcw size={12} />
                  </Button>
                </Tooltip>
              </div>
            )}
            {loadingVoices ? (
              <div className="mypage-empty">
                <span className="mypage-empty-title">LOADING VOICES...</span>
              </div>
            ) : !voicesError && voices.length === 0 ? (
              <div className="mypage-empty">
                <span className="mypage-empty-title">NO CUSTOM VOICES</span>
                <span className="mypage-empty-desc">
                  Attach a vocal sample in the Studio or save a voice from one of your songs.
                </span>
              </div>
            ) : (
              <div className="mypage-grid">
                {voices.map((voice) => (
                  <div key={voice.id} className="mypage-voice-card">
                    <div className="mypage-card-header">
                      <span className="mypage-item-title">{voice.name}</span>
                      {voice.status !== 'ready' && (
                        <Badge variant={voice.status === 'error' ? 'warning' : 'default'}>
                          {voiceStatus(voice).toUpperCase()}
                        </Badge>
                      )}
                    </div>
                    {(['turbo', 'sft'] as const).map((mode) => {
                      const availability = voice.availability[mode];
                      return availability.step != null &&
                        ['queued', 'training'].includes(availability.status) ? (
                        <div key={mode} className="studio-voice-detail">
                          {mode === 'turbo' ? 'Fast' : 'Master'}: Preparing · {availability.step}
                          {availability.total_steps != null
                            ? ` / ${availability.total_steps}`
                            : ''}
                        </div>
                      ) : null;
                    })}
                    {(voice.error ||
                      voice.availability.turbo.error ||
                      voice.availability.sft.error) && (
                        <div className="studio-voice-detail" role="alert">
                          {voice.error ||
                            voice.availability.turbo.error ||
                            voice.availability.sft.error}
                        </div>
                      )}
                    <div className="mypage-item-footer">
                      <span>{new Date(voice.created_at).toLocaleDateString()}</span>
                      {voice.sample_url && (
                        <Tooltip
                          title="Play Voice Sample"
                          description={`Preview vocal sample for ${voice.name}`}
                        >
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              const audio = new Audio(voice.sample_url!);
                              audio.play().catch(console.error);
                            }}
                            aria-label="Play voice sample"
                          >
                            <Volume2 size={12} />
                          </Button>
                        </Tooltip>
                      )}
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

      {/* Edit Song Details Modal */}
      <EditSongModal
        isOpen={Boolean(editingDetailsSong)}
        onClose={() => setEditingDetailsSong(null)}
        song={editingDetailsSong}
        activeAddress={activeAddress}
      />

      {/* Publish Confirmation Modal */}
      <PublishModal
        isOpen={Boolean(publishConfirmSong)}
        onClose={() => setPublishConfirmSong(null)}
        song={publishConfirmSong}
        activeAddress={activeAddress}
        formattedAddress={formattedAddress}
        albums={albums}
        onConfirm={async (song: Song) => {
          await togglePublic(song);
        }}
        pending={Boolean(publicPending)}
      />
    </div>
  );
};
