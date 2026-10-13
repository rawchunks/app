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
  Download,
  Trash2,
  Upload,
  Sliders,
  Tag,
} from 'lucide-react';
import { Tooltip } from '../components/daw/Tooltip';
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
import { useLicensedSongs, useLicense } from '../hooks/use-license';
import { useVoices, voiceAvailability, voiceStatus } from '../hooks/use-voices';
import { ProfileModal } from '../components/profile-modal';
import { EditSongModal } from '../components/edit-song';
import { PublishModal } from '../components/publish';
import { readSongs, writeSongs } from '../lib/cache';
import { groupSongs } from '../lib/versions';
import { Licenses } from '../components/licenses';
import { Versions } from '../components/versions';
import { CoverArt } from './market';

export interface Props {
  onEditSong: (song: Song) => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * On-chain live pricing and remaining/sold license statistics for published songs.
 */
const PublicSongPricingBox: React.FC<{ song: Song }> = ({ song }) => {
  const { data, sold } = useLicense(song);
  const remaining = data?.remaining !== undefined ? Number(data.remaining) : song.licenses;
  const soldCount = sold !== undefined ? sold : 0;

  return (
    <div className="market-pricing-box">
      <div className="market-price-item">
        <span className="market-price-label">STREAM</span>
        <span className="market-price-val market-price-val-stream">
          ${song.stream_price.toFixed(2)}
          <span className="market-price-unit">/m</span>
        </span>
      </div>
      <div className="market-price-item">
        <span className="market-price-label">LICENSES</span>
        <div className="mypage-license-stats-row">
          <Tooltip title="Licenses Sold" description={`${soldCount} licenses sold`}>
            <span className="mypage-stat-badge sold">
              <Tag size={10} /> {soldCount}
            </span>
          </Tooltip>
          <Tooltip title="Licenses Remaining" description={`${remaining} licenses remaining`}>
            <span className="mypage-stat-badge left">
              <Tag size={10} /> {remaining}
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};

/**
 * Uniform pricing box for user songs: shows stream + license price for private songs,
 * and stream + live sold/left statistics for published songs.
 */
const MySongPricingBox: React.FC<{ song: Song }> = ({ song }) => {
  if (!song.public) {
    return (
      <div className="market-pricing-box">
        <div className="market-price-item">
          <span className="market-price-label">STREAM</span>
          <span className="market-price-val market-price-val-stream">
            ${song.stream_price.toFixed(2)}
            <span className="market-price-unit">/m</span>
          </span>
        </div>
        <div className="market-price-item">
          <span className="market-price-label">LICENSE</span>
          <span className="market-price-val market-price-val-license">
            {song.source ? (
              <span className="market-price-remix">REMIX</span>
            ) : (
              `$${song.license_price.toFixed(2)}`
            )}
          </span>
        </div>
      </div>
    );
  }

  return <PublicSongPricingBox song={song} />;
};

/**
 * Compact, uniform 7-row Song Card for My-Page.
 * Matches market.tsx dimensions and visual hierarchy strictly.
 */
const MySongCard: React.FC<{
  song: Song;
  versions: Song[];
  albumTitle: string | null;
  albumCover: string | null;
  isPlayingThis: boolean;
  onPlayToggle: () => void;
  onSelectVersion: (version: Song) => void;
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onEditDetails: (song: Song) => void;
  onEditInStudio: (song: Song) => void;
  onDownload: (song: Song) => void;
  onDelete: (id: string) => void;
  onPublishClick: (song: Song) => void;
  publicPending: boolean;
  isRemixLicensed?: boolean;
}> = ({
  song,
  versions,
  albumTitle,
  albumCover,
  isPlayingThis,
  onPlayToggle,
  onSelectVersion,
  isMenuOpen,
  onToggleMenu,
  onEditDetails,
  onEditInStudio,
  onDownload,
  onDelete,
  onPublishClick,
  publicPending,
  isRemixLicensed = false,
}) => {
    return (
      <div className={`market-card ${isPlayingThis ? 'playing' : ''}`}>
        {/* 1. Square Artwork Media Container */}
        <CoverArt
          image={song.image}
          albumCover={albumCover}
          title={song.title}
          isPlayingThis={isPlayingThis}
          onPlayToggle={onPlayToggle}
          network={song.network}
          txHash={song.tx_hash}
          txUrl={song.tx_url}
          duration={song.duration}
          topRightActions={
            !isRemixLicensed ? (
              <div className="mypage-menu-wrap">
                <button
                  type="button"
                  className="mypage-card-more-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMenu();
                  }}
                  aria-label="Track options"
                  title="Track Options"
                >
                  •••
                </button>
                {isMenuOpen && (
                  <div className="mypage-menu-dropdown">
                    {!song.public && !song.tx_hash && !song.metadata_cid && (
                      <button
                        type="button"
                        className="mypage-menu-item mypage-item-details"
                        onClick={() => onEditDetails(song)}
                      >
                        <Sliders size={12} style={{ marginRight: 6 }} /> EDIT DETAILS
                      </button>
                    )}
                    <button
                      type="button"
                      className="mypage-menu-item mypage-item-edit"
                      onClick={() => onEditInStudio(song)}
                    >
                      <Pencil size={12} style={{ marginRight: 6 }} /> MUSIC EDITOR
                    </button>
                    <button
                      type="button"
                      className="mypage-menu-item mypage-item-download"
                      onClick={() => onDownload(song)}
                    >
                      <Download size={12} style={{ marginRight: 6 }} /> DOWNLOAD
                    </button>
                    <button
                      type="button"
                      className="mypage-menu-item mypage-item-delete"
                      onClick={() => onDelete(song.id)}
                    >
                      <Trash2 size={12} style={{ marginRight: 6 }} /> DELETE
                    </button>
                  </div>
                )}
              </div>
            ) : null
          }
        />

        {/* 2. Structured Metadata Body */}
        <div className="market-card-body mypage-card-body">
          {/* Top: Info (Title+Versions, Album, Tags) */}
          <div className="mypage-card-info">
            {/* Row 1: Title + Versions (horizontal, title occupies up to two thirds) */}
            <div className="mypage-card-row-title-wrap">
              <div className="mypage-card-title-col">
                <Tooltip title={song.title} description="Song title" className="mypage-card-title-tooltip">
                  <span className="mypage-card-title-text">{song.title}</span>
                </Tooltip>
              </div>
              {versions && versions.length > 1 && onSelectVersion && (
                <div className="mypage-card-versions-col">
                  <Versions
                    songs={versions}
                    selected={song.id}
                    onSelect={onSelectVersion}
                  />
                </div>
              )}
            </div>

            {/* Album (if present) */}
            {albumTitle && (
              <div className="market-card-row-album" title={`Album: ${albumTitle}`}>
                <Disc3 size={11} className="market-album-icon" />
                <span className="market-album-text">{albumTitle}</span>
              </div>
            )}

            {/* Tags & Remix Badge (if present) */}
            {((song.tags && song.tags.length > 0) || isRemixLicensed) && (
              <div className="market-card-row-tags">
                {isRemixLicensed && (
                  <Badge variant="warning" className="mypage-remix-badge">
                    REMIX
                  </Badge>
                )}
                {song.tags?.map((t) => (
                  <Badge key={t} variant="secondary">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Bottom: Pricing & Actions */}
          <div className="mypage-card-footer-box">
            {isRemixLicensed ? (
              <div className="market-pricing-box">
                <div className="market-price-item">
                  <span className="market-price-label">STREAM</span>
                  <span className="market-price-val market-price-val-stream">
                    ${song.stream_price.toFixed(2)}
                    <span className="market-price-unit">/m</span>
                  </span>
                </div>
                <div className="market-price-item">
                  <span className="market-price-label">STATUS</span>
                  <span className="market-price-val market-price-val-license">
                    LICENSED
                  </span>
                </div>
              </div>
            ) : (
              <MySongPricingBox song={song} />
            )}

            {/* Actions Toolbar */}
            <div className="market-card-actions">
              {isRemixLicensed ? (
                <Licenses
                  song={song}
                  placement="mypage"
                  onEditSong={onEditInStudio}
                  compact
                />
              ) : song.public ? (
                <div className="mypage-public-action-wrap">
                  <Badge variant="secondary" className="mypage-status-badge">
                    PUBLIC
                  </Badge>
                  <Licenses
                    song={song}
                    placement="mypage"
                    onEditSong={onEditInStudio}
                    compact
                  />
                </div>
              ) : (
                <div className="mypage-private-action-wrap">
                  <Badge variant="muted" className="mypage-status-badge">
                    PRIVATE
                  </Badge>
                  <Tooltip title="Publish" description="Mint on-chain and publish to Market">
                    <Button
                      variant="primary"
                      size="sm"
                      className="mypage-publish-icon-btn"
                      onClick={() => onPublishClick(song)}
                      disabled={Boolean(publicPending)}
                      aria-label="Publish track"
                    >
                      <Upload size={12} />
                    </Button>
                  </Tooltip>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

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
  // Empty dividers start closed by default; if songs exist in cache/store, start open
  const [songsOpen, setSongsOpen] = useState(() => (readAddress ? (readSongs(readAddress)?.length ?? 0) > 0 : true));
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
  const { voices, loading: loadingVoices, error: voicesError, refresh: refreshVoices } = useVoices(activeAddress);
  const { nickname, avatar } = useProfile(activeAddress);
  const formattedAddress = activeAddress ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}` : '';
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
      if ((e.target as HTMLElement).closest('.mypage-menu-wrap')) return;
      setMenuOpenId(null);
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [menuOpenId]);

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
        if (!userToggledSongs.current) {
          setSongsOpen(mapped.length > 0);
        }
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
      const response = await sdk.fetch(`/api/songs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete the song');
      store.deleteSong(id);
      toast.success('Song deleted successfully');
    } catch (err) {
      console.error('Song deletion failed', err);
      toast.error(err instanceof Error ? err.message : 'Could not delete the song');
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
                  {error ? 'COULD NOT LOAD SONGS' : loading || isReconnecting ? 'LOADING SONGS' : activeAddress ? 'NO SONGS GENERATED YET' : 'CONNECT YOUR WALLET'}
                </span>
                <span className="mypage-empty-desc">
                  {error ?? (loading || isReconnecting ? 'Loading your songs…' : activeAddress ? 'Go to /studio to create your first track.' : 'Connect your wallet to see your songs.')}
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
                    <MySongCard
                      key={family}
                      song={song}
                      versions={versions}
                      albumTitle={albumTitle}
                      albumCover={albumCover}
                      isPlayingThis={isPlayingThis}
                      onPlayToggle={() => {
                        if (isPlayingThis) {
                          store.setPlaying(false);
                        } else {
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
                  {licensed.loading ? 'Retrieving your on-chain licenses…' : 'Licenses you purchase in the Market will appear here for remixing.'}
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
                    <MySongCard
                      key={family}
                      song={song}
                      versions={versions}
                      albumTitle={albumTitle}
                      albumCover={albumCover}
                      isPlayingThis={isPlayingThis}
                      onPlayToggle={() => {
                        if (isPlayingThis) {
                          store.setPlaying(false);
                        } else {
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
                      isMenuOpen={false}
                      onToggleMenu={() => { }}
                      onEditDetails={() => { }}
                      onEditInStudio={onEditSong}
                      onDownload={handleDownload}
                      onDelete={handleDelete}
                      onPublishClick={() => { }}
                      publicPending={false}
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
                <Button variant="ghost" size="sm" onClick={() => { void refreshVoices(); }}>
                  RETRY
                </Button>
              </div>
            )}
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
                    <div className="studio-voice-availability" role="status">
                      <span>Fast: {voiceAvailability(voice, 'turbo')}</span>
                      <span>Master: {voiceAvailability(voice, 'sft')}</span>
                    </div>
                    {(['turbo', 'sft'] as const).map((mode) => {
                      const availability = voice.availability[mode];
                      return availability.step != null && ['queued', 'training'].includes(availability.status) ? (
                        <div key={mode} className="studio-voice-detail">
                          {mode === 'turbo' ? 'Fast' : 'Master'}: Preparing · {availability.step}
                          {availability.total_steps != null ? ` / ${availability.total_steps}` : ''}
                        </div>
                      ) : null;
                    })}
                    {(voice.error || voice.availability.turbo.error || voice.availability.sft.error) && (
                      <div className="studio-voice-detail" role="alert">
                        {voice.error || voice.availability.turbo.error || voice.availability.sft.error}
                      </div>
                    )}
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
