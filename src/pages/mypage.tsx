import { useGuideOwner, prepareViews, draftCanLeave } from '../components/guide/owners';
import { api } from '@/lib/api';
import React, { useState, useEffect, useRef, useMemo, useCallback, Fragment } from 'react';
import { toast } from 'sonner';
import {
  Pencil,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Disc3,
  Mic2,
  Music,
  User,
  RotateCcw,
  ListMusic,
  Lock,
  Globe,
  Play,
  Pause,
  Trash2,
  Plus,
  X,
  Search,
  Clock,
  Sparkles,
  GitBranch,
  Headphones,
  Calendar,
  LayoutGrid,
  List,
  Columns3,
  BarChart3,
  TrendingUp,
  Briefcase,
  DollarSign,
  Folder,
  Image as ImageIcon,
  KeyRound,
  Layers,
  Activity,
  Heart,
} from 'lucide-react';
import { Tooltip } from '../components/daw/Tooltip';
import { Glitch } from '../components/glitch';
import { Button } from '../components/button';
import { Badge } from '../components/badge';
import { Draft, type FinderViewMode } from '../components/songs/draft';
import { Asset } from '../components/songs/asset';
import { Earn } from '../components/ag';
import { GenreBadges } from '../components/ag/genres';
import { useLikes } from '../hooks/use-social';
import {
  DATE_WINDOW_OPTIONS,
  SOURCE_OPTIONS,
  formatMs,
  type DateWindow,
  type RevenueSourceFilter,
  type StatId,
} from '../components/ag/utils';
import { AlbumModal } from '../components/songs/album';
import {
  useCreatorEarnings,
  computeAggregatedEarnings,
  formatUsd,
  getNetworkLogo,
  type NetworkFilter,
} from '../hooks/use-earnings';
import { store, State } from '../lib/store';
import { Song, Album, Playlist, Voice } from '../lib/schema';
import { useSelectedUserAddress } from '../hooks/use-address';
import { usePublic } from '../hooks/use-public';
import { useProfile } from '../hooks/use-profile';
import { useSongs } from '../hooks/use-songs';
import { useLicensedSongs, useCatalogLicenseSales } from '../hooks/use-license';
import { useVoices, voiceStatus } from '../hooks/use-voices';
import {
  useCreatorAlbums,
  createAlbumApi,
  updateAlbumApi,
  deleteAlbumApi,
  addSongToAlbumApi,
  removeSongFromAlbumApi,
} from '../hooks/use-albums';
import {
  useCreatorPlaylists,
  createPlaylistApi,
  updatePlaylistApi,
  removeSongFromPlaylistApi,
  deletePlaylistApi,
} from '../hooks/use-playlists';
import { useQueryClient } from '@tanstack/react-query';
import {
  ProfileModal,
  CreatorProfileCard,
  sanitizeCreatorNickname,
} from '../components/profile';
import { navigateToCreator } from '../lib/routes';
import { EditSongModal } from '../components/options';
import { PublishModal } from '../components/songs/publish';
import { ShareModal } from '../components/share';
import { readSongs, writeSongs } from '../lib/cache';
import { groupSongs } from '../lib/versions';
import { useDismiss } from '../hooks/use-dismiss';
import { openGate } from '@/lib/gate';
import {
  getMintSuccessForShare,
  clearMintSuccessShare,
  saveMintSuccessForShare,
  songToShareData,
  type MintShareData,
} from '../lib/share';

const MENU_IGNORE_SELECTORS = [
  '.mypage-menu-wrap',
  '.mypage-menu-dropdown',
  '.market-view-select-wrap',
  '.guide-card',
  '.guide-portal-root',
  '.guide-layer',
  '.guide-popover',
  '.guide-overlay-root',
];

const voiceOnsetCache = new Map<string, number>();

async function detectAudioOnsetSec(url: string): Promise<number> {
  const cached = voiceOnsetCache.get(url);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-655359' } });
    if (!res.ok) {
      voiceOnsetCache.set(url, 0);
      return 0;
    }
    const buf = await res.arrayBuffer();
    const view = new DataView(buf);
    if (buf.byteLength < 44 || view.getUint32(0, false) !== 0x52494646) {
      voiceOnsetCache.set(url, 0);
      return 0;
    }
    let offset = 12;
    let audioFormat = 1;
    let channels = 1;
    let sampleRate = 44100;
    let bitsPerSample = 16;
    let dataOffset = -1;
    let dataSize = 0;

    while (offset + 8 <= buf.byteLength) {
      const chunkId = view.getUint32(offset, false);
      const chunkSize = view.getUint32(offset + 4, true);
      if (chunkId === 0x666d7420 && offset + 24 <= buf.byteLength) {
        audioFormat = view.getUint16(offset + 8, true);
        channels = Math.max(1, view.getUint16(offset + 10, true));
        sampleRate = Math.max(8000, view.getUint32(offset + 12, true));
        bitsPerSample = view.getUint16(offset + 22, true);
      } else if (chunkId === 0x64617461) {
        dataOffset = offset + 8;
        dataSize = chunkSize;
        break;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }

    if (dataOffset < 0 || dataOffset >= buf.byteLength) {
      voiceOnsetCache.set(url, 0);
      return 0;
    }

    const bytesPerSample = Math.max(1, bitsPerSample >> 3);
    const frameSize = bytesPerSample * channels;
    const availableBytes = Math.min(buf.byteLength - dataOffset, dataSize || buf.byteLength - dataOffset);
    const totalFrames = Math.floor(availableBytes / frameSize);
    const windowFrames = Math.max(1, Math.floor(sampleRate * 0.05));
    const threshold = 0.014;

    for (let f = 0; f + windowFrames <= totalFrames; f += windowFrames) {
      let sumSq = 0;
      const step = Math.max(1, Math.floor(windowFrames / 120));
      let count = 0;
      for (let i = 0; i < windowFrames; i += step) {
        const framePos = dataOffset + (f + i) * frameSize;
        if (framePos + bytesPerSample > buf.byteLength) break;
        let sample = 0;
        if (audioFormat === 3 && bitsPerSample === 32) {
          sample = view.getFloat32(framePos, true);
        } else if (bitsPerSample === 16) {
          sample = view.getInt16(framePos, true) / 32768;
        } else if (bitsPerSample === 24) {
          const b0 = view.getUint8(framePos);
          const b1 = view.getUint8(framePos + 1);
          const b2 = view.getInt8(framePos + 2);
          sample = ((b2 << 16) | (b1 << 8) | b0) / 8388608;
        } else if (bitsPerSample === 32) {
          sample = view.getInt32(framePos, true) / 2147483648;
        }
        sumSq += sample * sample;
        count++;
      }
      const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
      if (rms >= threshold) {
        const onset = Math.max(0, f / sampleRate - 0.12);
        voiceOnsetCache.set(url, onset);
        return onset;
      }
    }

    voiceOnsetCache.set(url, 0);
    return 0;
  } catch {
    return 0;
  }
}

export interface Props {
  onEditSong: (song: Song) => void;
  className?: string;
}

export const Mypage: React.FC<Props> = ({ onEditSong, className = '' }) => {
  const { readAddress, isReconnecting } =
    useSelectedUserAddress();

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
  const [, setPlaylistsOpen] = useState(false);
  const [voicesOpen, setVoicesOpen] = useState(false);

  // Track manual user toggle overrides so clicks remain responsive
  const userToggledSongs = useRef(false);
  const userToggledLicenses = useRef(false);
  const userToggledAlbums = useRef(false);
  const userToggledPlaylists = useRef(false);
  const userToggledVoices = useRef(false);

  // Modals State
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingDetailsSong, setEditingDetailsSong] = useState<Song | null>(null);
  const [publishConfirmSong, setPublishConfirmSong] = useState<Song | null>(null);
  const [albumTargetSong, setAlbumTargetSong] = useState<Song | null>(null);
  const [albumStudioOpen, setAlbumStudioOpen] = useState(false);
  const [editingAlbum, setEditingAlbum] = useState<Album | null>(null);

  // Top-level Mode Switcher ('workspace' | 'earn') with sessionStorage memory & Finder View State
  const [activeTab, setActiveTab] = useState<'workspace' | 'earn'>(() => {
    try {
      const saved = sessionStorage.getItem('rawchunks:mypage:tab');
      return saved === 'earn' ? 'earn' : 'workspace';
    } catch {
      return 'workspace';
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem('rawchunks:mypage:tab', activeTab);
    } catch {
      // Ignore storage write errors
    }
  }, [activeTab]);
  const [finderView, setFinderView] = useState<FinderViewMode>('grid');
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [columnFolder, setColumnFolder] = useState<string>('all');
  const [columnFolderDropdownOpen, setColumnFolderDropdownOpen] = useState(false);
  const [inspectedFamilyKey, setInspectedFamilyKey] = useState<string | null>(null);

  // EARN Tab State (Aggregated Analytics + Network Filter + Sort + View)
  const [earnNetworkFilter, setEarnNetworkFilter] = useState<NetworkFilter>('all');
  const [earnNetDropdownOpen, setEarnNetDropdownOpen] = useState(false);
  const [earnSort, setEarnSort] = useState<'profit' | 'sold' | 'plays' | 'recent'>('profit');
  const [earnSortDropdownOpen, setEarnSortDropdownOpen] = useState(false);
  const [earnView, setEarnView] = useState<'list' | 'charts'>(() => {
    try {
      const saved = sessionStorage.getItem('rawchunks:mypage:earnView');
      return saved === 'charts' ? 'charts' : 'list';
    } catch {
      return 'list';
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem('rawchunks:mypage:earnView', earnView);
    } catch {
      // Ignore storage write errors
    }
  }, [earnView]);
  const [earnViewDropdownOpen, setEarnViewDropdownOpen] = useState(false);
  const [earnSourceFilter, setEarnSourceFilter] = useState<RevenueSourceFilter>('all');
  const [earnSourceDropdownOpen, setEarnSourceDropdownOpen] = useState(false);
  const [earnDateWindow, setEarnDateWindow] = useState<DateWindow>('30d');
  const [earnDateDropdownOpen, setEarnDateDropdownOpen] = useState(false);
  const [earnSelectedStat, setEarnSelectedStat] = useState<StatId>('profit');
  const [earnStatDropdownOpen, setEarnStatDropdownOpen] = useState(false);

  // Workspace Snap-Deck & Stage Navigation State
  const [workspaceStage, setWorkspaceStage] = useState<'songs' | 'licenses' | 'catalog'>('songs');
  const [licenseSearch, setLicenseSearch] = useState('');
  const [catalogMobileTab, setCatalogMobileTab] = useState<'albums' | 'playlists' | 'voices'>('albums');
  const workspaceDeckRef = useRef<HTMLDivElement | null>(null);
  const stageSongsRef = useRef<HTMLElement | null>(null);
  const stageLicensesRef = useRef<HTMLElement | null>(null);
  const stageCatalogRef = useRef<HTMLElement | null>(null);
  const workspaceSnapLockRef = useRef(0);
  const workspaceTouchStartYRef = useRef<number | null>(null);
  const workspaceTouchTargetRef = useRef<EventTarget | null>(null);

  const scrollToWorkspaceStage = useCallback((stage: 'songs' | 'licenses' | 'catalog') => {
    setWorkspaceStage(stage);
    const el =
      stage === 'songs'
        ? stageSongsRef.current
        : stage === 'licenses'
          ? stageLicensesRef.current
          : stageCatalogRef.current;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleWorkspaceDeckScroll = useCallback(() => {
    const deck = workspaceDeckRef.current;
    if (!deck) return;
    const h = deck.clientHeight || 1;
    const idx = Math.round(deck.scrollTop / h);
    const nextStage = idx <= 0 ? 'songs' : idx === 1 ? 'licenses' : 'catalog';
    setWorkspaceStage((prev) => (prev === nextStage ? prev : nextStage));
  }, []);

  const canInnerElementScroll = useCallback(
    (target: EventTarget | null, deltaY: number): boolean => {
      const deck = workspaceDeckRef.current;
      let el = target instanceof HTMLElement ? target : null;
      while (el && el !== deck) {
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 2
        ) {
          if (deltaY > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 2) {
            return true;
          }
          if (deltaY < 0 && el.scrollTop > 1) {
            return true;
          }
        }
        el = el.parentElement;
      }
      return false;
    },
    []
  );

  const stepWorkspaceStage = useCallback(
    (direction: 1 | -1) => {
      const now = Date.now();
      if (now - workspaceSnapLockRef.current < 450) return;
      const stages: Array<'songs' | 'licenses' | 'catalog'> = ['songs', 'licenses', 'catalog'];
      const deck = workspaceDeckRef.current;
      const currentIdx = deck
        ? Math.max(0, Math.min(2, Math.round(deck.scrollTop / (deck.clientHeight || 1))))
        : stages.indexOf(workspaceStage);
      const nextIdx = Math.max(0, Math.min(stages.length - 1, currentIdx + direction));
      if (nextIdx !== currentIdx) {
        workspaceSnapLockRef.current = now;
        scrollToWorkspaceStage(stages[nextIdx]);
      }
    },
    [workspaceStage, scrollToWorkspaceStage]
  );

  const handleWorkspaceWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (Math.abs(e.deltaY) < 18 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (canInnerElementScroll(e.target, e.deltaY)) return;
      stepWorkspaceStage(e.deltaY > 0 ? 1 : -1);
    },
    [canInnerElementScroll, stepWorkspaceStage]
  );

  const handleWorkspaceTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    workspaceTouchStartYRef.current = e.touches[0].clientY;
    workspaceTouchTargetRef.current = e.target;
  }, []);

  const handleWorkspaceTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const startY = workspaceTouchStartYRef.current;
      workspaceTouchStartYRef.current = null;
      if (startY === null || e.changedTouches.length === 0) return;
      const deltaY = startY - e.changedTouches[0].clientY;
      if (Math.abs(deltaY) < 36) return;
      if (canInnerElementScroll(workspaceTouchTargetRef.current, deltaY)) return;
      stepWorkspaceStage(deltaY > 0 ? 1 : -1);
    },
    [canInnerElementScroll, stepWorkspaceStage]
  );

  // Workspace Songs Filter, Sort & Time-Horizon State
  const [songSort, setSongSort] = useState<'recent' | 'date' | 'added' | 'edits'>('recent');
  const [songSearch, setSongSearch] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [collapsedHorizons, setCollapsedHorizons] = useState<Record<string, boolean>>({});
  const [hasMoreSongs, setHasMoreSongs] = useState(false);
  const [loadingMoreSongs, setLoadingMoreSongs] = useState(false);

  // Albums local UI state
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [expandedAlbumId, setExpandedAlbumId] = useState<string | null>(null);
  const [togglingAlbumId, setTogglingAlbumId] = useState<string | null>(null);
  const [assigningAlbumId, setAssigningAlbumId] = useState<string | null>(null);

  // Playlists local UI state
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [showCreatePlaylistInput, setShowCreatePlaylistInput] = useState(false);
  const [expandedPlaylistId, setExpandedPlaylistId] = useState<string | null>(null);
  const [myPlaylistPage, setMyPlaylistPage] = useState(0);
  const [togglingPlaylistId, setTogglingPlaylistId] = useState<string | null>(null);
  const [loadingVoiceId, setLoadingVoiceId] = useState<string | null>(null);

  const activeAddress = readAddress;
  const queryClient = useQueryClient();
  const { data: publicSongs = [], error: publicSongsError } = useSongs();
  const { data: albums = [], isLoading: loadingAlbums } = useCreatorAlbums(activeAddress);
  const { data: myPlaylists = [], isLoading: loadingPlaylists } = useCreatorPlaylists(activeAddress);
  const licensed = useLicensedSongs(publicSongs);
  const {
    voices,
    loading: loadingVoices,
    error: voicesError,
    refresh: refreshVoices,
  } = useVoices(activeAddress);
  const { nickname, avatar, bio, banner, socials } = useProfile(activeAddress);
  const formattedAddress = activeAddress
    ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}`
    : '';
  const sanitizedNickname = useMemo(
    () => sanitizeCreatorNickname(nickname, activeAddress) || '',
    [nickname, activeAddress]
  );
  const { toggle: togglePublic, pending: publicPending } = usePublic();
  const {
    data: earningsData,
    isLoading: loadingEarnings,
    refetch: refetchEarnings,
  } = useCreatorEarnings(activeAddress, 'all');

  // Fast album lookup map
  const albumsMap = useMemo(() => {
    const map = new Map<string, Album>();
    albums.forEach((a) => map.set(a.id, a));
    return map;
  }, [albums]);

  // Combined song map (public + user's own songs) for playlist resolution
  const allKnownSongsById = useMemo(() => {
    const map = new Map<string, Song>();
    for (const s of publicSongs) map.set(s.id, s);
    for (const s of state.songs) map.set(s.id, s);
    return map;
  }, [publicSongs, state.songs]);

  const { likedSongIds, toggleLike } = useLikes(activeAddress);
  const likedSongs = useMemo(
    () =>
      likedSongIds
        .map((id) => allKnownSongsById.get(id))
        .filter((s): s is Song => Boolean(s)),
    [likedSongIds, allKnownSongsById]
  );

  // Playlists sorted in "last modified" order (updated_at descending, then created_at descending)
  const sortedMyPlaylists = useMemo(
    () =>
      [...myPlaylists].sort((a, b) => {
        const tB = Date.parse(b.updated_at || b.created_at || '') || 0;
        const tA = Date.parse(a.updated_at || a.created_at || '') || 0;
        return tB - tA;
      }),
    [myPlaylists]
  );
  const MY_PLAYLISTS_PER_PAGE = 4;
  const myPlaylistTotalPages = Math.max(
    1,
    Math.ceil(sortedMyPlaylists.length / MY_PLAYLISTS_PER_PAGE)
  );
  const clampedMyPlaylistPage = Math.min(myPlaylistPage, myPlaylistTotalPages - 1);
  const visibleMyPlaylists = useMemo(
    () =>
      sortedMyPlaylists.slice(
        clampedMyPlaylistPage * MY_PLAYLISTS_PER_PAGE,
        (clampedMyPlaylistPage + 1) * MY_PLAYLISTS_PER_PAGE
      ),
    [sortedMyPlaylists, clampedMyPlaylistPage]
  );

  const originalSongs = useMemo(
    () => state.songs.filter((s) => !s.is_remix && !s.source),
    [state.songs]
  );
  const originalFamilies = useMemo(() => groupSongs(originalSongs), [originalSongs]);

  // Strict separation: WORKSPACE holds private WIP versions; EARN holds each published version (including published remixes)
  const workspaceFamilies = useMemo(
    () =>
      originalFamilies
        .map((versions) =>
          versions.filter((s) => !s.public && !s.chain_song_id && !s.metadata_cid)
        )
        .filter((versions) => versions.length > 0),
    [originalFamilies]
  );

  const publishedSongsList = useMemo(
    () =>
      state.songs.filter((s) => Boolean(s.public || s.chain_song_id || s.metadata_cid)),
    [state.songs]
  );

  // Progressive version numbers (#1, #2, #3...) strictly for songs with >1 published version
  const publishedVersionNumberById = useMemo(() => {
    const groups = new Map<string, Song[]>();
    const titleToGroupKey = new Map<string, string>();

    for (const s of publishedSongsList) {
      const famKey = s.family ? `fam:${s.family}` : null;
      const normTitle = (s.title || '').trim().toLowerCase();
      const titleKey = normTitle ? `title:${normTitle}` : null;

      let groupKey = famKey || titleKey || `id:${s.id}`;
      if (famKey && groups.has(famKey)) {
        groupKey = famKey;
      } else if (titleKey && titleToGroupKey.has(titleKey)) {
        groupKey = titleToGroupKey.get(titleKey)!;
      }

      if (titleKey) titleToGroupKey.set(titleKey, groupKey);
      if (famKey) titleToGroupKey.set(famKey, groupKey);

      const list = groups.get(groupKey);
      if (list) list.push(s);
      else groups.set(groupKey, [s]);
    }

    const versionMap = new Map<string, number>();
    for (const list of groups.values()) {
      if (list.length <= 1) continue;
      const sorted = [...list].sort((a, b) => {
        const vDiff = (a.version ?? 1) - (b.version ?? 1);
        if (vDiff !== 0) return vDiff;
        const tA = Date.parse(a.created_at || '') || 0;
        const tB = Date.parse(b.created_at || '') || 0;
        if (tA !== tB) return tA - tB;
        const pA = Date.parse(a.published_at || '') || 0;
        const pB = Date.parse(b.published_at || '') || 0;
        if (pA !== pB) return pA - pB;
        return a.id.localeCompare(b.id);
      });
      sorted.forEach((song, idx) => {
        versionMap.set(song.id, idx + 1);
      });
    }
    return versionMap;
  }, [publishedSongsList]);

  // Resolve album across song or its family versions so every version knows its album
  const familyAlbumMap = useMemo(() => {
    const map = new Map<string, Album>();
    for (const s of state.songs) {
      if (s.album_id) {
        const alb = albumsMap.get(s.album_id);
        if (alb) {
          map.set(s.id, alb);
          if (s.family) map.set(s.family, alb);
        }
      }
    }
    return map;
  }, [state.songs, albumsMap]);

  const draftsCount = workspaceFamilies.length;
  const publishedCount = publishedSongsList.length;
  const liveLicenseSales = useCatalogLicenseSales(publishedSongsList);

  const earnAnalytics = useMemo(
    () =>
      computeAggregatedEarnings(
        publishedSongsList,
        earningsData,
        earnNetworkFilter,
        liveLicenseSales
      ),
    [publishedSongsList, earningsData, earnNetworkFilter, liveLicenseSales]
  );

  const filteredSortedFamilies = useMemo(() => {
    const q = songSearch.trim().toLowerCase();
    const filtered = workspaceFamilies.filter((versions) => {
      const family = versions[0].family ?? versions[0].id;
      const head = versions.find((s) => s.id === selected[family]) ?? versions[0];
      if (finderView === 'columns') {
        if (columnFolder === 'multi' && versions.length <= 1) return false;
        if (columnFolder === 'unassigned' && head.album_id) return false;
        if (columnFolder.startsWith('album:')) {
          const targetAlbumId = columnFolder.slice('album:'.length);
          if (head.album_id !== targetAlbumId) return false;
        }
      }
      if (q) {
        const albumTitle = (head.album_id ? albumsMap.get(head.album_id)?.title : head.album_title) || '';
        const matchTitle = head.title.toLowerCase().includes(q);
        const matchTags = (head.tags || []).some((t) => t.toLowerCase().includes(q));
        const matchAlbum = albumTitle.toLowerCase().includes(q);
        if (!matchTitle && !matchTags && !matchAlbum) return false;
      }
      return true;
    });

    const getModifiedMs = (versions: Song[]) =>
      Math.max(...versions.map((v) => new Date(v.created_at || 0).getTime() || 0));
    const getAddedMs = (versions: Song[]) =>
      Math.min(...versions.map((v) => new Date(v.created_at || 0).getTime() || 0));

    return [...filtered].sort((a, b) => {
      if (songSort === 'added') return getAddedMs(b) - getAddedMs(a);
      if (songSort === 'edits') {
        const diff = b.length - a.length;
        return diff !== 0 ? diff : getModifiedMs(b) - getModifiedMs(a);
      }
      return getModifiedMs(b) - getModifiedMs(a);
    });
  }, [workspaceFamilies, selected, finderView, columnFolder, songSearch, songSort, albumsMap]);

  // Keep Miller column inspector synchronized with active filtered list
  const inspectedFamily = useMemo(() => {
    if (filteredSortedFamilies.length === 0) return null;
    if (inspectedFamilyKey) {
      const found = filteredSortedFamilies.find(
        (v) => (v[0].family ?? v[0].id) === inspectedFamilyKey
      );
      if (found) return found;
    }
    return filteredSortedFamilies[0];
  }, [filteredSortedFamilies, inspectedFamilyKey]);

  const searchSortedEarnSongs = useMemo(() => {
    const q = songSearch.trim().toLowerCase();
    const filtered = publishedSongsList.filter((song) => {
      if (q) {
        const albumTitle = (song.album_id ? albumsMap.get(song.album_id)?.title : song.album_title) || '';
        const matchTitle = song.title.toLowerCase().includes(q);
        const matchTags = (song.tags || []).some((t) => t.toLowerCase().includes(q));
        const matchAlbum = albumTitle.toLowerCase().includes(q);
        if (!matchTitle && !matchTags && !matchAlbum) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      const metricA = earnAnalytics.allSongMetrics[a.id];
      const metricB = earnAnalytics.allSongMetrics[b.id];
      if (earnSort === 'profit') {
        const diff = (metricB?.totalProfitUsd ?? 0) - (metricA?.totalProfitUsd ?? 0);
        if (diff !== 0) return diff;
      } else if (earnSort === 'sold') {
        const diff = (metricB?.licensesSold ?? 0) - (metricA?.licensesSold ?? 0);
        if (diff !== 0) return diff;
      } else if (earnSort === 'plays') {
        const diff = (metricB?.plays ?? b.plays ?? 0) - (metricA?.plays ?? a.plays ?? 0);
        if (diff !== 0) return diff;
      }
      const modA = new Date(a.created_at || 0).getTime() || 0;
      const modB = new Date(b.created_at || 0).getTime() || 0;
      return modB - modA;
    });
  }, [publishedSongsList, earnAnalytics.allSongMetrics, songSearch, earnSort, albumsMap]);

  const filteredEarnSongs = useMemo(() => {
    const allowedIds = new Set(earnAnalytics.filteredSongs.map((s) => s.id));
    return searchSortedEarnSongs.filter((song) => allowedIds.has(song.id));
  }, [searchSortedEarnSongs, earnAnalytics.filteredSongs]);

  const earnKpiItems = useMemo<
    Array<{
      id: StatId;
      label: string;
      value: string;
      icon: React.ComponentType<{ size?: number; className?: string }>;
      tooltip: string;
    }>
  >(
    () => [
      {
        id: 'profit',
        label: 'PROFIT',
        value: formatUsd(earnAnalytics.summary.totalProfitUsd),
        icon: DollarSign,
        tooltip: `Creator Profit (80%): Licenses ${formatUsd(earnAnalytics.summary.licenseProfitUsd)} • Streams ${formatUsd(earnAnalytics.summary.streamProfitUsd)}`,
      },
      {
        id: 'plays',
        label: 'PLAYS',
        value: earnAnalytics.summary.totalPlays.toLocaleString(),
        icon: Headphones,
        tooltip: `${earnAnalytics.summary.totalPlays.toLocaleString()} public streams across ${earnAnalytics.summary.publishedCount} releases`,
      },
      {
        id: 'streamed',
        label: 'STREAMED',
        value: formatMs(earnAnalytics.summary.totalStreamedMs),
        icon: Clock,
        tooltip: 'Total listening duration across all published releases',
      },
      {
        id: 'ratio',
        label: 'AVG RATIO',
        value: `${earnAnalytics.summary.avgRatioPct.toFixed(1)}%`,
        icon: Activity,
        tooltip: 'Average % of track duration streamed per play',
      },
      {
        id: 'licenses',
        label: 'LICENSES',
        value: `${earnAnalytics.summary.licensesSold} / ${earnAnalytics.summary.licensesMinted}`,
        icon: Disc3,
        tooltip: `${earnAnalytics.summary.licensesSold} sold • ${earnAnalytics.summary.licensesRemaining} remaining of ${earnAnalytics.summary.licensesMinted} minted`,
      },
    ],
    [earnAnalytics.summary]
  );

  const activeEarnKpi = useMemo(
    () => earnKpiItems.find((k) => k.id === earnSelectedStat) ?? earnKpiItems[0],
    [earnKpiItems, earnSelectedStat]
  );

  const otherEarnKpis = useMemo(
    () => earnKpiItems.filter((k) => k.id !== activeEarnKpi.id),
    [earnKpiItems, activeEarnKpi]
  );

  const secondaryEarnKpis = useMemo(
    () => earnKpiItems.filter((k) => k.id === 'ratio' || k.id === 'licenses'),
    [earnKpiItems]
  );

  const handleSelectEarnStat = (statId: StatId) => {
    setEarnSelectedStat(statId);
    setEarnStatDropdownOpen(false);
    if (statId === 'profit' || statId === 'plays') {
      setEarnSort(statId);
    } else if (statId === 'licenses') {
      setEarnSort('sold');
    }
  };

  const horizonFolds = useMemo(() => {
    const now = Date.now();
    const DAY = 86_400_000;
    const buckets: { key: string; label: string; families: Song[][] }[] = [
      { key: 'today', label: 'TODAY', families: [] },
      { key: 'week', label: 'THIS WEEK', families: [] },
      { key: 'month', label: 'THIS MONTH', families: [] },
      { key: 'earlier', label: 'EARLIER', families: [] },
    ];
    for (const versions of filteredSortedFamilies) {
      const ts =
        songSort === 'added'
          ? Math.min(...versions.map((v) => new Date(v.created_at || 0).getTime() || 0))
          : Math.max(...versions.map((v) => new Date(v.created_at || 0).getTime() || 0));
      const age = Math.max(0, now - ts);
      if (age < DAY) buckets[0].families.push(versions);
      else if (age < 7 * DAY) buckets[1].families.push(versions);
      else if (age < 30 * DAY) buckets[2].families.push(versions);
      else buckets[3].families.push(versions);
    }
    return buckets.filter((b) => b.families.length > 0);
  }, [filteredSortedFamilies, songSort]);
  const allUserRemixSongs = useMemo(
    () => state.songs.filter((s) => Boolean(s.is_remix || s.source)),
    [state.songs]
  );
  const remixSongs = useMemo(
    () =>
      allUserRemixSongs.filter((s) => !s.public && !s.chain_song_id && !s.metadata_cid),
    [allUserRemixSongs]
  );
  const unforkedLicensedSongs = useMemo(() => {
    const forkedSourceIds = new Set(
      allUserRemixSongs.map((s) => s.source).filter((id): id is string => Boolean(id))
    );
    return licensed.songs.filter((s) => !forkedSourceIds.has(s.id));
  }, [licensed.songs, allUserRemixSongs]);
  const totalLicensesCount = remixSongs.length + unforkedLicensedSongs.length;

  const filteredRemixSongs = useMemo(() => {
    const q = licenseSearch.trim().toLowerCase();
    if (!q) return remixSongs;
    return remixSongs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }, [remixSongs, licenseSearch]);

  const filteredUnforkedLicensedSongs = useMemo(() => {
    const q = licenseSearch.trim().toLowerCase();
    if (!q) return unforkedLicensedSongs;
    return unforkedLicensedSongs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }, [unforkedLicensedSongs, licenseSearch]);

  // Close dropdowns when clicking outside (guide overlays excluded)
  useDismiss(
    Boolean(
      menuOpenId ||
      viewDropdownOpen ||
      sortDropdownOpen ||
      columnFolderDropdownOpen ||
      earnNetDropdownOpen ||
      earnSortDropdownOpen ||
      earnViewDropdownOpen ||
      earnSourceDropdownOpen ||
      earnDateDropdownOpen ||
      earnStatDropdownOpen
    ),
    () => {
      setMenuOpenId(null);
      setViewDropdownOpen(false);
      setSortDropdownOpen(false);
      setColumnFolderDropdownOpen(false);
      setEarnNetDropdownOpen(false);
      setEarnSortDropdownOpen(false);
      setEarnViewDropdownOpen(false);
      setEarnSourceDropdownOpen(false);
      setEarnDateDropdownOpen(false);
      setEarnStatDropdownOpen(false);
    },
    undefined,
    MENU_IGNORE_SELECTORS
  );

  const guideView = { activeTab, finderView, earnView, songsOpen, licensesOpen, albumsOpen, voicesOpen, menuOpenId, editingDetailsSong, publishConfirmSong, profileModalOpen };
  const guideViewRef = useRef(guideView); guideViewRef.current = guideView;
  useGuideOwner({
    id: 'workspace', scope: activeAddress ?? 'guest', handles: step => ['W1', 'W2', 'W3', 'W4', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7'].includes(step.id),
    prepare: ({ step, bind }) => {
      const displayed = groupSongs(state.songs).map(versions => versions.find(song => song.id === selected[versions[0].family ?? versions[0].id]) ?? versions[0]);
      const candidate = displayed.find(song => !song.public && !song.tx_hash && !song.metadata_cid) ?? displayed[0];
      const songId = bind('song', candidate?.id);
      const song = displayed.find(song => song.id === songId);
      const isPublishedCandidate = Boolean(song && (song.public || song.chain_song_id || song.metadata_cid));
      const patch: Partial<typeof guideView> = {
        activeTab: isPublishedCandidate && ['W3', 'K5', 'K7'].includes(step.id) ? 'earn' : 'workspace',
        finderView: 'grid',
        earnView: 'list',
      };
      if (!['K2', 'K3', 'K4', 'K6'].includes(step.id)) {
        patch.songsOpen = true;
        if (patch.activeTab === 'workspace') {
          setTimeout(() => scrollToWorkspaceStage('songs'), 30);
        }
      }
      if (step.id === 'K2') {
        patch.licensesOpen = true;
        setTimeout(() => scrollToWorkspaceStage('licenses'), 30);
      }
      if (step.id === 'K3') {
        patch.albumsOpen = true;
        setCatalogMobileTab('albums');
        setTimeout(() => scrollToWorkspaceStage('catalog'), 30);
      }
      if (step.id === 'K4') {
        patch.voicesOpen = true;
        setCatalogMobileTab('voices');
        setTimeout(() => scrollToWorkspaceStage('catalog'), 30);
      }
      if (step.id === 'K6') patch.profileModalOpen = true;
      if (step.id === 'W3' && song) patch.menuOpenId = song.id;
      const privateSong = song && !song.public && !song.tx_hash && !song.metadata_cid;
      if (step.id === 'W2' && privateSong) patch.editingDetailsSong = song;
      if (step.id === 'W4' && song && !song.public) patch.publishConfirmSong = song;
      const view = prepareViews(guideView, () => guideViewRef.current, {
        activeTab: setActiveTab, finderView: setFinderView, earnView: setEarnView,
        songsOpen: setSongsOpen, licensesOpen: setLicensesOpen, albumsOpen: setAlbumsOpen, voicesOpen: setVoicesOpen, menuOpenId: setMenuOpenId,
        editingDetailsSong: setEditingDetailsSong, publishConfirmSong: setPublishConfirmSong, profileModalOpen: setProfileModalOpen
      }, patch);
      const result = { ...view, canLeave: () => draftCanLeave('song-details') && draftCanLeave('profile'), leave: () => { if (draftCanLeave('song-details') && draftCanLeave('profile')) view.leave?.(); } };
      if (step.id === 'W2' && !privateSong || step.id === 'W4' && (!song || song.public)) return { ...result, target: 'workspace.songs-heading', description: 'This step needs a private song in MY SONGS.' };
      if (['W3', 'K5', 'K7'].includes(step.id) && !song) return { ...result, target: 'workspace.songs-heading', description: loading ? 'Your songs are loading.' : 'Your songs appear here after you generate a track.' };
      return {
        ...result, entity: ['W2', 'W3', 'W4', 'K5', 'K7'].includes(step.id) ? songId : undefined,
        focus: step.id === 'W2' || step.id === 'K6' ? 'input' : undefined
      };
    },
  });

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
    if (!activeAddress && !isReconnecting) {
      store.setSongs([]);
      setState(store.getState());
      return;
    }
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
  }, [activeAddress, isReconnecting]);

  // Fetch Songs (paginated batch of 100, with loadMore support for 1000+ songs)
  const PAGE_LIMIT = 100;
  useEffect(() => {
    if (!activeAddress) {
      setLoading(false);
      setHasMoreSongs(false);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const res = await api.fetch(
          `/api/songs?creator=${encodeURIComponent(activeAddress)}&limit=${PAGE_LIMIT}&offset=0`,
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
          image: s.image || '',
          licenses: s.licenses ?? 0,
          stream_price: Number(s.stream_price),
          license_price: Number(s.license_price),
          url: s.url ?? '',
        }));
        store.setSongs(mapped);
        setHasMoreSongs(mapped.length >= PAGE_LIMIT);
        if (!userToggledSongs.current) {
          setSongsOpen(mapped.some((s) => !s.is_remix && !s.source));
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

  const handleLoadMoreSongs = async () => {
    if (!activeAddress || loadingMoreSongs || !hasMoreSongs) return;
    setLoadingMoreSongs(true);
    try {
      const offset = state.songs.length;
      const res = await api.fetch(
        `/api/songs?creator=${encodeURIComponent(activeAddress)}&limit=${PAGE_LIMIT}&offset=${offset}`,
        { userAddress: activeAddress }
      );
      const dbSongs = await res.json();
      if (!res.ok || !Array.isArray(dbSongs)) throw new Error('Could not load more songs');
      const mapped: Song[] = dbSongs.map((s: any) => ({
        ...s,
        tags: s.tags ?? [],
        public: s.public ?? false,
        image: s.image || '',
        licenses: s.licenses ?? 0,
        stream_price: Number(s.stream_price),
        license_price: Number(s.license_price),
        url: s.url ?? '',
      }));
      const existingIds = new Set(state.songs.map((s) => s.id));
      const merged = [...state.songs, ...mapped.filter((s) => !existingIds.has(s.id))];
      store.setSongs(merged);
      setHasMoreSongs(mapped.length >= PAGE_LIMIT);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load more songs');
    } finally {
      setLoadingMoreSongs(false);
    }
  };

  // Share success dialog state
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareData, setShareData] = useState<MintShareData | null>(null);

  useEffect(() => {
    const data = getMintSuccessForShare();
    if (data) {
      setShareData(data);
      setShowShareDialog(true);
    }
  }, []);

  const handleCloseShareDialog = (open: boolean) => {
    setShowShareDialog(open);
    if (!open) {
      clearMintSuccessShare();
      setShareData(null);
    }
  };

  useEffect(() => {
    if (!licensed.loading && !userToggledLicenses.current) {
      setLicensesOpen(totalLicensesCount > 0);
    }
  }, [licensed.loading, totalLicensesCount]);

  useEffect(() => {
    if (!loadingAlbums && !userToggledAlbums.current) {
      setAlbumsOpen(albums.length > 0);
    }
  }, [loadingAlbums, albums.length]);

  useEffect(() => {
    if (!loadingPlaylists && !userToggledPlaylists.current) {
      setPlaylistsOpen(myPlaylists.length > 0);
    }
  }, [loadingPlaylists, myPlaylists.length]);

  useEffect(() => {
    if (!loadingVoices && !userToggledVoices.current) {
      setVoicesOpen(voices.length > 0);
    }
  }, [loadingVoices, voices.length]);

  const handleCreateAlbum = async (e: React.FormEvent, songToAttach?: Song | null) => {
    e.preventDefault();
    if (!activeAddress || !newAlbumTitle.trim()) return;
    setCreatingAlbum(true);
    try {
      const created = await createAlbumApi(
        {
          title: newAlbumTitle.trim(),
          creator: activeAddress,
          public: false,
        },
        activeAddress
      );
      if (songToAttach) {
        if (songToAttach.album_id && songToAttach.album_id !== created.id) {
          await removeSongFromAlbumApi(songToAttach.album_id, songToAttach.id, activeAddress);
        }
        await addSongToAlbumApi(created.id, songToAttach.id, activeAddress);
        store.updateSong(songToAttach.id, { album_id: created.id, album_title: created.title });
        setAlbumTargetSong(null);
      }
      await queryClient.invalidateQueries({ queryKey: ['albums'] });
      setNewAlbumTitle('');
      toast.success(songToAttach ? `Added to "${created.title}"` : 'Created album');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create album');
    } finally {
      setCreatingAlbum(false);
    }
  };

  const handleToggleSongInAlbum = async (album: Album, song: Song) => {
    if (!activeAddress || assigningAlbumId) return;
    setAssigningAlbumId(album.id);
    try {
      const isAlreadyIn = song.album_id === album.id;
      if (isAlreadyIn) {
        await removeSongFromAlbumApi(album.id, song.id, activeAddress);
        store.updateSong(song.id, { album_id: null, album_title: null });
        toast.success(`Removed from "${album.title}"`);
      } else {
        if (song.album_id && song.album_id !== album.id) {
          await removeSongFromAlbumApi(song.album_id, song.id, activeAddress);
        }
        await addSongToAlbumApi(album.id, song.id, activeAddress);
        store.updateSong(song.id, { album_id: album.id, album_title: album.title });
        toast.success(`Added to "${album.title}"`);
      }
      await queryClient.invalidateQueries({ queryKey: ['albums'] });
      setAlbumTargetSong(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update album');
    } finally {
      setAssigningAlbumId(null);
    }
  };

  const handleToggleAlbumPublic = async (album: Album) => {
    if (!activeAddress || togglingAlbumId === album.id) return;
    setTogglingAlbumId(album.id);
    try {
      const nextPublic = !album.public;
      await updateAlbumApi(album.id, { public: nextPublic }, activeAddress);
      await queryClient.invalidateQueries({ queryKey: ['albums'] });
      toast.success(
        nextPublic ? `Album "${album.title}" is now PUBLIC` : `Album "${album.title}" is now PRIVATE`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update album visibility');
    } finally {
      setTogglingAlbumId(null);
    }
  };

  const handleRemoveAlbumSong = async (albumId: string, songId: string) => {
    if (!activeAddress) return;
    try {
      await removeSongFromAlbumApi(albumId, songId, activeAddress);
      store.updateSong(songId, { album_id: null, album_title: null });
      await queryClient.invalidateQueries({ queryKey: ['albums'] });
      toast.success('Track removed from album');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove track from album');
    }
  };

  const handleDeleteAlbum = async (album: Album) => {
    if (!activeAddress) return;
    try {
      await deleteAlbumApi(album.id, activeAddress);
      for (const s of state.songs) {
        if (s.album_id === album.id) {
          store.updateSong(s.id, { album_id: null, album_title: null });
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['albums'] });
      toast.success(`Deleted album "${album.title}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete album');
    }
  };

  const handlePlayMyAlbum = (album: Album) => {
    const resolved = state.songs.filter((s) => s.album_id === album.id);
    if (resolved.length === 0) {
      toast.error('Add tracks to play this album.');
      return;
    }
    void store.playCollection(resolved, `album:${album.id}`, album.id);
  };

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAddress || !newPlaylistName.trim()) return;
    setCreatingPlaylist(true);
    try {
      await createPlaylistApi(
        {
          title: newPlaylistName.trim(),
          creator: activeAddress,
          song_ids: [],
          public: false,
        },
        activeAddress
      );
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setNewPlaylistName('');
      setShowCreatePlaylistInput(false);
      toast.success('Created private playlist');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create playlist');
    } finally {
      setCreatingPlaylist(false);
    }
  };

  const handleTogglePlaylistPublic = async (playlist: Playlist) => {
    if (!activeAddress || togglingPlaylistId === playlist.id) return;
    setTogglingPlaylistId(playlist.id);
    try {
      const nextPublic = !playlist.public;
      await updatePlaylistApi(playlist.id, { public: nextPublic }, activeAddress);
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast.success(
        nextPublic
          ? `Playlist "${playlist.title}" is now PUBLIC on /market`
          : `Playlist "${playlist.title}" is now PRIVATE`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update playlist visibility');
    } finally {
      setTogglingPlaylistId(null);
    }
  };

  const handleRemovePlaylistSong = async (playlistId: string, songId: string) => {
    if (!activeAddress) return;
    try {
      await removeSongFromPlaylistApi(playlistId, songId, activeAddress);
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast.success('Track removed from playlist');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove track');
    }
  };

  const handleDeletePlaylist = async (playlist: Playlist) => {
    if (!activeAddress) return;
    try {
      await deletePlaylistApi(playlist.id, activeAddress);
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast.success(`Deleted playlist "${playlist.title}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete playlist');
    }
  };

  const handlePlayMyPlaylist = (playlist: Playlist) => {
    const resolved = (playlist.song_ids || [])
      .map((id) => allKnownSongsById.get(id))
      .filter((s): s is Song => Boolean(s));
    if (resolved.length === 0) {
      toast.error('Add tracks from /market to play this playlist.');
      return;
    }
    void store.playCollection(resolved, `playlist:${playlist.id}`, playlist.id);
  };

  const resolveVoiceAudioUrl = (voice: Voice): string => {
    if (voice.sample_url && voice.sample_url.trim() !== '') return voice.sample_url.trim();
    const metaSourceUrl =
      typeof voice.metadata?.source_url === 'string' ? voice.metadata.source_url.trim() : '';
    if (metaSourceUrl) return metaSourceUrl;
    const sourceSongId =
      typeof voice.metadata?.source_song_id === 'string' ? voice.metadata.source_song_id.trim() : '';
    if (sourceSongId) {
      const sourceSong = allKnownSongsById.get(sourceSongId);
      if (sourceSong?.url) return sourceSong.url;
    }
    return '';
  };

  const handlePlayVoice = async (voice: Voice) => {
    const voiceUrl = resolveVoiceAudioUrl(voice);
    if (!voiceUrl) {
      toast.error('No audio sample available for this voice yet.');
      return;
    }
    const voiceSongId = `voice:${voice.id}`;
    if (state.isPlaying && state.activeSong?.id === voiceSongId) {
      await store.setPlaying(false);
      return;
    }
    if (!state.isPlaying && state.activeSong?.id === voiceSongId) {
      await store.setPlaying(true);
      return;
    }
    setLoadingVoiceId(voice.id);
    try {
      const sourceSongId =
        typeof voice.metadata?.source_song_id === 'string'
          ? voice.metadata.source_song_id.trim()
          : '';
      const sourceSong = sourceSongId ? allKnownSongsById.get(sourceSongId) : undefined;
      const onsetSec = await detectAudioOnsetSec(voiceUrl);
      const voiceSong: Song = {
        id: voiceSongId,
        title: voice.name,
        creator: activeAddress || voice.creator,
        url: voiceUrl,
        image: sourceSong?.image || '',
        tags: ['VOICE'],
        public: false,
        duration: sourceSong?.duration || 0,
        licenses: 0,
        stream_price: 0,
        license_price: 0,
      };
      store.setActiveSong(voiceSong, [voiceSong], voice.id, voice.id, true);
      if (onsetSec > 0.25) {
        store.setPlayhead(onsetSec);
      }
      await store.setPlaying(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not play voice sample');
    } finally {
      setLoadingVoiceId(null);
    }
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
      const res = await fetch(song.url);
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
      const response = await api.fetch(`/api/songs/${encodeURIComponent(id)}`, {
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

  const renderDraftItem = (
    versions: Song[],
    includeAlbumAction = true,
    overrideViewMode?: FinderViewMode,
    isRemixLicensed = false
  ) => {
    const family = versions[0].family ?? versions[0].id;
    const song = versions.find((s) => s.id === selected[family]) ?? versions[0];
    const isPlayingThis = state.isPlaying && state.activeSong?.id === song.id;
    const album =
      (song.album_id ? albumsMap.get(song.album_id) : null) ||
      familyAlbumMap.get(song.id) ||
      familyAlbumMap.get(family) ||
      null;
    const albumTitle = album?.title || song.album_title || null;
    const albumCover = album?.cover || null;
    const mode = overrideViewMode ?? finderView;
    const isSelectedForInspect =
      mode === 'columns' && (inspectedFamily?.[0]?.family ?? inspectedFamily?.[0]?.id) === family;

    return (
      <Draft
        key={family}
        song={song}
        versions={versions}
        viewMode={mode}
        isSelected={isSelectedForInspect}
        onSelectRow={() => setInspectedFamilyKey(family)}
        albumTitle={albumTitle}
        albumCover={albumCover}
        isPlayingThis={isPlayingThis}
        onPlayToggle={() => {
          if (isPlayingThis) {
            store.setPlaying(false);
          } else {
            store.playSong(song, state.songs, null);
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
        onToggleMenu={() => {
          setEarnStatDropdownOpen(false);
          setEarnNetDropdownOpen(false);
          setEarnSortDropdownOpen(false);
          setEarnSourceDropdownOpen(false);
          setEarnDateDropdownOpen(false);
          setMenuOpenId(menuOpenId === song.id ? null : song.id);
        }}
        onEditDetails={
          isRemixLicensed
            ? undefined
            : (s) => {
              setMenuOpenId(null);
              setEditingDetailsSong(s);
            }
        }
        onAddToAlbum={
          includeAlbumAction && !isRemixLicensed
            ? (s) => {
              setMenuOpenId(null);
              setAlbumTargetSong(s);
            }
            : undefined
        }
        onEditInStudio={(s) => {
          setMenuOpenId(null);
          onEditSong(s);
        }}
        onDownload={handleDownload}
        onDelete={handleDelete}
        onPublishClick={isRemixLicensed ? undefined : (s) => setPublishConfirmSong(s)}
        publicPending={Boolean(publicPending)}
        isRemixLicensed={isRemixLicensed}
      />
    );
  };

  const renderAssetItem = (song: Song) => {
    const familyKey = song.family ?? song.id;
    const versionNumber = publishedVersionNumberById.get(song.id) ?? null;
    const isPlayingThis = state.isPlaying && state.activeSong?.id === song.id;
    const album =
      (song.album_id ? albumsMap.get(song.album_id) : null) ||
      familyAlbumMap.get(song.id) ||
      familyAlbumMap.get(familyKey) ||
      null;
    const albumTitle = album?.title || song.album_title || null;
    const albumCover = album?.cover || null;
    const earning = earnAnalytics.songMetrics[song.id] ?? undefined;

    return (
      <Asset
        key={song.id}
        song={song}
        versionNumber={versionNumber}
        earning={earning}
        networkFilter={earnNetworkFilter}
        albumTitle={albumTitle}
        albumCover={albumCover}
        isPlayingThis={isPlayingThis}
        isMenuOpen={menuOpenId === song.id}
        onToggleMenu={() => {
          setEarnStatDropdownOpen(false);
          setEarnNetDropdownOpen(false);
          setEarnSortDropdownOpen(false);
          setEarnSourceDropdownOpen(false);
          setEarnDateDropdownOpen(false);
          setMenuOpenId(menuOpenId === song.id ? null : song.id);
        }}
        onPlayToggle={() => {
          if (isPlayingThis) {
            store.setPlaying(false);
          } else {
            store.playSong(song, state.songs, null);
          }
        }}
        onDownload={handleDownload}
        onDelete={handleDelete}
        onShare={(s) => {
          setMenuOpenId(null);
          setShareData(
            songToShareData(
              s,
              nickname?.trim() || activeAddress || s.creator,
              false,
              albumCover
            )
          );
          setShowShareDialog(true);
        }}
      />
    );
  };

  return (
    <div className={`mypage-container ${className}`}>
      {/* Page Header + Workspace Snap-Stage Indicator Pills */}
      <div className="mypage-header">
        <div className="mypage-header-left">
          <div className="mypage-title-cluster">
            <Glitch text="MY_PAGE" className="mypage-title-text" />
            <Tooltip
              title="Preview Public Creator Profile"
              description="Open your public /creator studio page"
            >
              <button
                type="button"
                className="mypage-vault-pill public mypage-preview-btn"
                onClick={() => {
                  const handle = sanitizedNickname || activeAddress;
                  if (handle) {
                    navigateToCreator(handle);
                  } else {
                    void openGate({ steps: ['login'], force: true });
                  }
                }}
                aria-label="Preview Public Profile"
              >
                <Globe size={11} />
                <span className="mypage-preview-label">PREVIEW</span>
              </button>
            </Tooltip>
          </div>
          <div className="mypage-subtitle">
            {activeTab === 'workspace'
              ? `YOUR WORKSPACE`
              : `YOUR CREATOR DASHBOARD`}
          </div>
        </div>

        {activeTab === 'workspace' && (
          <nav className="market-stage-nav workspace-stage-nav" aria-label="Workspace stages">
            <button
              type="button"
              className={`market-stage-pill ${workspaceStage === 'songs' ? 'active' : ''}`}
              onClick={() => scrollToWorkspaceStage('songs')}
              aria-label={`01 My Songs (${workspaceFamilies.length})`}
            >
              <span className="market-stage-num">01</span>
              <Lock size={11} className="market-stage-icon" />
              <span className="market-stage-label">SONGS</span>
              <span className="workspace-stage-pill-count">{workspaceFamilies.length}</span>
            </button>
            <button
              type="button"
              className={`market-stage-pill ${workspaceStage === 'licenses' ? 'active' : ''}`}
              onClick={() => scrollToWorkspaceStage('licenses')}
              aria-label={`02 My Licenses (${totalLicensesCount})`}
            >
              <span className="market-stage-num">02</span>
              <KeyRound size={11} className="market-stage-icon" />
              <span className="market-stage-label">LICENSES</span>
              <span className="workspace-stage-pill-count">{totalLicensesCount}</span>
            </button>
            <button
              type="button"
              className={`market-stage-pill ${workspaceStage === 'catalog' ? 'active' : ''}`}
              onClick={() => scrollToWorkspaceStage('catalog')}
              aria-label={`03 Catalog (${albums.length + myPlaylists.length + voices.length})`}
            >
              <span className="market-stage-num">03</span>
              <Layers size={11} className="market-stage-icon" />
              <span className="market-stage-label">CATALOG</span>
              <span className="workspace-stage-pill-count">
                {albums.length + myPlaylists.length + voices.length}
              </span>
            </button>
          </nav>
        )}
      </div>

      {/* SECTION (i): Profile Header */}
      {activeAddress ? (
        <div className="mypage-profile-bar">
          <CreatorProfileCard
            variant="mypage"
            address={activeAddress}
            songs={publishedSongsList}
            nickname={nickname}
            avatar={avatar}
            bio={bio}
            banner={banner}
            socials={socials}
            onEdit={() => setProfileModalOpen(true)}
          />

          <div className="mypage-profile-right">
            <div className="mypage-profile-mode-tabs" role="tablist" aria-label="Creator page mode">
              {activeTab === 'workspace' ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={true}
                  className="mypage-profile-mode-tab active"
                  onClick={() => setActiveTab('workspace')}
                  aria-label="Workspace"
                >
                  <Briefcase size={12} />
                  <span className="mypage-tab-label">WORKSPACE</span>
                </button>
              ) : (
                <Tooltip title="Go to WORKSPACE (Private Drafts, Stems & Voices)">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={false}
                    className="mypage-profile-mode-tab"
                    onClick={() => setActiveTab('workspace')}
                    aria-label="Go to WORKSPACE"
                  >
                    <Briefcase size={12} />
                    <span className="mypage-tab-label">WORKSPACE</span>
                  </button>
                </Tooltip>
              )}

              {activeTab === 'earn' ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={true}
                  className="mypage-profile-mode-tab active"
                  onClick={() => setActiveTab('earn')}
                  aria-label="Earn"
                >
                  <TrendingUp size={12} />
                  <span className="mypage-tab-label">EARN</span>
                </button>
              ) : (
                <Tooltip title="Go to EARN (Published Releases & On-Chain Royalties)">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={false}
                    className="mypage-profile-mode-tab"
                    onClick={() => setActiveTab('earn')}
                    aria-label="Go to EARN"
                  >
                    <TrendingUp size={12} />
                    <span className="mypage-tab-label">EARN</span>
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mypage-profile-card">
          <div className="mypage-profile-left">
            <div className="mypage-profile-avatar-placeholder">
              <User size={20} />
            </div>
            <div className="mypage-profile-details">
              <div className="mypage-profile-nickname-row">
                <span className="mypage-profile-nickname">
                  {isReconnecting ? 'RECONNECTING...' : 'CONNECT YOUR ACCOUNT'}
                </span>
              </div>
              <p className="mypage-profile-bio">
                Sign in with Google, Email, Passkey, or Wallet to customize your creator profile and manage your tracks, licenses, albums, and voices.
              </p>
            </div>
          </div>
          {!isReconnecting && (
            <div className="mypage-profile-stats">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void openGate({ steps: ['login'], force: true })}
              >
                SIGN IN
              </Button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'workspace' ? (
        <div
          ref={workspaceDeckRef}
          className="workspace-snap-deck"
          data-guide="mypage-sections"
          onScroll={handleWorkspaceDeckScroll}
          onWheel={handleWorkspaceWheel}
          onTouchStart={handleWorkspaceTouchStart}
          onTouchEnd={handleWorkspaceTouchEnd}
        >
          {/* STAGE 01: MY SONGS (Private Studio Drafts & macOS Finder) */}
          <section
            ref={stageSongsRef}
            className="workspace-snap-stage"
            data-stage="songs"
            aria-label="My Songs"
          >
            <div className="mypage-section workspace-stage-panel">
              <div
                className={`board-section-separator workspace-stage-header ${mobileSearchOpen || Boolean(songSearch) ? 'search-open' : ''}`}
                data-guide="workspace.songs-heading"
              >
                <div className="board-section-left">
                  <span className="market-stage-num">01</span>
                  <Lock size={12} />
                  <span className="mypage-section-title">MY SONGS</span>
                  <span className="board-section-badge">{filteredSortedFamilies.length}</span>
                </div>

                {workspaceFamilies.length > 0 && (
                  <div
                    className="board-section-actions mypage-header-controls"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {/* Expandable Search */}
                    <div
                      className={`mypage-header-search ${mobileSearchOpen || Boolean(songSearch) ? 'expanded' : ''}`}
                    >
                      <button
                        type="button"
                        className="mypage-header-search-toggle"
                        onClick={() => {
                          setMobileSearchOpen((prev) => {
                            const next = !prev;
                            if (next) {
                              setTimeout(() => searchInputRef.current?.focus(), 0);
                            }
                            return next;
                          });
                        }}
                        aria-label="Search tracks"
                      >
                        <Search size={12} />
                      </button>
                      <input
                        ref={searchInputRef}
                        type="text"
                        className="mypage-header-search-input"
                        placeholder="Search drafts..."
                        value={songSearch}
                        onChange={(e) => setSongSearch(e.target.value)}
                      />
                      {(songSearch || mobileSearchOpen) && (
                        <button
                          type="button"
                          className="mypage-header-search-clear"
                          onClick={() => {
                            setSongSearch('');
                            setMobileSearchOpen(false);
                          }}
                          aria-label="Clear search"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>

                    {/* Mobile Collections Filter Dropdown (shown in Columns view on mobile) */}
                    {finderView === 'columns' && (
                      <div className="market-view-select-wrap mypage-mobile-col-filter">
                        <button
                          type="button"
                          className={`mypage-header-trigger ${columnFolderDropdownOpen ? 'open' : ''}`}
                          onClick={() => {
                            setViewDropdownOpen(false);
                            setSortDropdownOpen(false);
                            setColumnFolderDropdownOpen((prev) => !prev);
                          }}
                          aria-haspopup="listbox"
                          aria-expanded={columnFolderDropdownOpen}
                          aria-label="Filter collection folder"
                        >
                          {columnFolder === 'all' ? (
                            <Folder size={12} />
                          ) : columnFolder === 'multi' ? (
                            <GitBranch size={12} />
                          ) : columnFolder === 'unassigned' ? (
                            <Music size={12} />
                          ) : (
                            <Disc3 size={12} />
                          )}
                          <span className="mypage-dropdown-label">
                            {columnFolder === 'all'
                              ? 'ALL DRAFTS'
                              : columnFolder === 'multi'
                                ? 'MULTI-VERSION'
                                : columnFolder === 'unassigned'
                                  ? 'UNASSIGNED'
                                  : (() => {
                                    const albId = columnFolder.replace('album:', '');
                                    const alb = albums.find((a) => a.id === albId);
                                    return alb ? alb.title.toUpperCase() : 'COLLECTION';
                                  })()}
                          </span>
                          <ChevronDown size={11} className="market-popover-chevron" />
                        </button>

                        {columnFolderDropdownOpen && (
                          <div className="market-popover-menu mypage-header-popover">
                            <div className="market-popover-list" role="listbox">
                              <button
                                type="button"
                                role="option"
                                aria-selected={columnFolder === 'all'}
                                className={`market-popover-option ${columnFolder === 'all' ? 'selected' : ''}`}
                                onClick={() => {
                                  setColumnFolder('all');
                                  setColumnFolderDropdownOpen(false);
                                }}
                              >
                                <Folder size={12} />
                                <span>ALL DRAFTS ({workspaceFamilies.length})</span>
                              </button>
                              <button
                                type="button"
                                role="option"
                                aria-selected={columnFolder === 'multi'}
                                className={`market-popover-option ${columnFolder === 'multi' ? 'selected' : ''}`}
                                onClick={() => {
                                  setColumnFolder('multi');
                                  setColumnFolderDropdownOpen(false);
                                }}
                              >
                                <GitBranch size={12} />
                                <span>
                                  MULTI-VERSION ({workspaceFamilies.filter((v) => v.length > 1).length})
                                </span>
                              </button>
                              <button
                                type="button"
                                role="option"
                                aria-selected={columnFolder === 'unassigned'}
                                className={`market-popover-option ${columnFolder === 'unassigned' ? 'selected' : ''}`}
                                onClick={() => {
                                  setColumnFolder('unassigned');
                                  setColumnFolderDropdownOpen(false);
                                }}
                              >
                                <Music size={12} />
                                <span>
                                  UNASSIGNED (
                                  {
                                    workspaceFamilies.filter((v) => {
                                      const f = v[0].family ?? v[0].id;
                                      const h = v.find((s) => s.id === selected[f]) ?? v[0];
                                      return !h.album_id;
                                    }).length
                                  }
                                  )
                                </span>
                              </button>
                              {albums.map((alb) => {
                                const folderKey = `album:${alb.id}`;
                                const count = workspaceFamilies.filter((v) => {
                                  const f = v[0].family ?? v[0].id;
                                  const h = v.find((s) => s.id === selected[f]) ?? v[0];
                                  return h.album_id === alb.id;
                                }).length;
                                return (
                                  <button
                                    key={alb.id}
                                    type="button"
                                    role="option"
                                    aria-selected={columnFolder === folderKey}
                                    className={`market-popover-option ${columnFolder === folderKey ? 'selected' : ''}`}
                                    onClick={() => {
                                      setColumnFolder(folderKey);
                                      setColumnFolderDropdownOpen(false);
                                    }}
                                  >
                                    <Disc3 size={12} />
                                    <span>
                                      {alb.title} ({count})
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Desktop Segmented macOS Finder View Switcher (GRID | LIST | COLUMNS) */}
                    <div className="finder-segmented-bar" role="group" aria-label="Finder view mode">
                      <button
                        type="button"
                        className={`finder-segmented-btn ${finderView === 'grid' ? 'active' : ''}`}
                        onClick={() => setFinderView('grid')}
                        title="Icon Grid View"
                      >
                        <LayoutGrid size={11} />
                        <span>GRID</span>
                      </button>
                      <button
                        type="button"
                        className={`finder-segmented-btn ${finderView === 'list' ? 'active' : ''}`}
                        onClick={() => setFinderView('list')}
                        title="Ledger List View"
                      >
                        <List size={11} />
                        <span>LIST</span>
                      </button>
                      <button
                        type="button"
                        className={`finder-segmented-btn ${finderView === 'columns' ? 'active' : ''}`}
                        onClick={() => setFinderView('columns')}
                        title="Miller Column Browser"
                      >
                        <Columns3 size={11} />
                        <span>COLUMNS</span>
                      </button>
                    </div>

                    {/* Mobile Finder View Dropdown (GRID | LIST | COLUMNS) */}
                    <div className="market-view-select-wrap finder-mobile-view-select">
                      <button
                        type="button"
                        className={`mypage-header-trigger ${viewDropdownOpen ? 'open' : ''}`}
                        onClick={() => {
                          setSortDropdownOpen(false);
                          setColumnFolderDropdownOpen(false);
                          setViewDropdownOpen((prev) => !prev);
                        }}
                        aria-haspopup="listbox"
                        aria-expanded={viewDropdownOpen}
                        aria-label="Finder view mode"
                      >
                        {finderView === 'list' ? (
                          <List size={12} />
                        ) : finderView === 'columns' ? (
                          <Columns3 size={12} />
                        ) : (
                          <LayoutGrid size={12} />
                        )}
                        <span className="mypage-dropdown-label">
                          {finderView === 'list'
                            ? 'LIST'
                            : finderView === 'columns'
                              ? 'COLUMNS'
                              : 'GRID'}
                        </span>
                        <ChevronDown size={11} className="market-popover-chevron" />
                      </button>

                      {viewDropdownOpen && (
                        <div className="market-popover-menu mypage-header-popover">
                          <div className="market-popover-list" role="listbox">
                            <button
                              type="button"
                              role="option"
                              aria-selected={finderView === 'grid'}
                              className={`market-popover-option ${finderView === 'grid' ? 'selected' : ''}`}
                              onClick={() => {
                                setFinderView('grid');
                                setViewDropdownOpen(false);
                              }}
                            >
                              <LayoutGrid size={12} />
                              <span>GRID</span>
                            </button>
                            <button
                              type="button"
                              role="option"
                              aria-selected={finderView === 'list'}
                              className={`market-popover-option ${finderView === 'list' ? 'selected' : ''}`}
                              onClick={() => {
                                setFinderView('list');
                                setViewDropdownOpen(false);
                              }}
                            >
                              <List size={12} />
                              <span>LIST</span>
                            </button>
                            <button
                              type="button"
                              role="option"
                              aria-selected={finderView === 'columns'}
                              className={`market-popover-option ${finderView === 'columns' ? 'selected' : ''}`}
                              onClick={() => {
                                setFinderView('columns');
                                setViewDropdownOpen(false);
                              }}
                            >
                              <Columns3 size={12} />
                              <span>COLUMNS</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Sort Dropdown (RECENT | BY DATE | ADDED | EDITS) */}
                    <div className="market-view-select-wrap">
                      <button
                        type="button"
                        className={`mypage-header-trigger ${sortDropdownOpen ? 'open' : ''}`}
                        onClick={() => {
                          setViewDropdownOpen(false);
                          setSortDropdownOpen((prev) => !prev);
                        }}
                        aria-haspopup="listbox"
                        aria-expanded={sortDropdownOpen}
                        aria-label="Sort tracks"
                      >
                        {songSort === 'date' ? (
                          <Calendar size={11} />
                        ) : songSort === 'added' ? (
                          <Sparkles size={11} />
                        ) : songSort === 'edits' ? (
                          <GitBranch size={11} />
                        ) : (
                          <Clock size={11} />
                        )}
                        <span className="mypage-dropdown-label">
                          {songSort === 'date'
                            ? 'BY DATE'
                            : songSort === 'added'
                              ? 'ADDED'
                              : songSort === 'edits'
                                ? 'EDITS'
                                : 'RECENT'}
                        </span>
                        <ChevronDown size={11} className="market-popover-chevron" />
                      </button>

                      {sortDropdownOpen && (
                        <div className="market-popover-menu mypage-header-popover">
                          <div className="market-popover-list" role="listbox">
                            <button
                              type="button"
                              role="option"
                              aria-selected={songSort === 'recent'}
                              className={`market-popover-option ${songSort === 'recent' ? 'selected' : ''}`}
                              onClick={() => {
                                setSongSort('recent');
                                setSortDropdownOpen(false);
                              }}
                            >
                              <Clock size={12} />
                              <span>RECENT</span>
                            </button>
                            <button
                              type="button"
                              role="option"
                              aria-selected={songSort === 'date'}
                              className={`market-popover-option ${songSort === 'date' ? 'selected' : ''}`}
                              onClick={() => {
                                setSongSort('date');
                                setSortDropdownOpen(false);
                              }}
                            >
                              <Calendar size={12} />
                              <span>BY DATE</span>
                            </button>
                            <button
                              type="button"
                              role="option"
                              aria-selected={songSort === 'added'}
                              className={`market-popover-option ${songSort === 'added' ? 'selected' : ''}`}
                              onClick={() => {
                                setSongSort('added');
                                setSortDropdownOpen(false);
                              }}
                            >
                              <Sparkles size={12} />
                              <span>ADDED</span>
                            </button>
                            <button
                              type="button"
                              role="option"
                              aria-selected={songSort === 'edits'}
                              className={`market-popover-option ${songSort === 'edits' ? 'selected' : ''}`}
                              onClick={() => {
                                setSongSort('edits');
                                setSortDropdownOpen(false);
                              }}
                            >
                              <GitBranch size={12} />
                              <span>EDITS</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="mypage-section-body workspace-stage-content">
                {error && originalSongs.length > 0 && <div role="alert">{error}</div>}

                {workspaceFamilies.length === 0 ? (
                  <div className="mypage-empty">
                    <span className="mypage-empty-title">
                      {error
                        ? 'COULD NOT LOAD SONGS'
                        : loading || isReconnecting
                          ? 'LOADING SONGS'
                          : activeAddress
                            ? publishedCount > 0
                              ? 'ALL TRACKS PUBLISHED'
                              : 'NO DRAFTS YET'
                            : 'LOGIN OR CONNECT YOUR WALLET'}
                    </span>
                    <span className="mypage-empty-desc">
                      {error ??
                        (loading || isReconnecting
                          ? 'Loading your workspace…'
                          : activeAddress
                            ? publishedCount > 0
                              ? 'Your published releases and royalties are in the EARN tab.'
                              : 'Create a track in Studio to start organizing your private workspace.'
                            : 'Connect your account to access your private drafts.')}
                    </span>
                    {publishedCount > 0 && (
                      <Button variant="secondary" size="xs" onClick={() => setActiveTab('earn')}>
                        <TrendingUp size={11} />
                        <span>OPEN EARN ({publishedCount})</span>
                      </Button>
                    )}
                  </div>
                ) : filteredSortedFamilies.length === 0 && finderView !== 'columns' ? (
                  <div className="mypage-empty">
                    <span className="mypage-empty-title">NO MATCHING DRAFTS</span>
                  </div>
                ) : finderView === 'columns' ? (
                  /* macOS Finder 3-Pane Miller Column Browser */
                  <div className="finder-columns-browser">
                    {/* Column 1: Collections & Smart Folders */}
                    <div className="finder-col-pane finder-col-folders">
                      <div className="finder-col-header">COLLECTIONS</div>
                      <button
                        type="button"
                        className={`finder-col-item ${columnFolder === 'all' ? 'selected' : ''}`}
                        onClick={() => setColumnFolder('all')}
                      >
                        <Folder size={13} />
                        <span className="finder-col-title">All Drafts</span>
                        <span className="finder-col-versions-pill">{workspaceFamilies.length}</span>
                      </button>
                      <button
                        type="button"
                        className={`finder-col-item ${columnFolder === 'multi' ? 'selected' : ''}`}
                        onClick={() => setColumnFolder('multi')}
                      >
                        <GitBranch size={13} />
                        <span className="finder-col-title">Multi-Version</span>
                        <span className="finder-col-versions-pill">
                          {workspaceFamilies.filter((v) => v.length > 1).length}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`finder-col-item ${columnFolder === 'unassigned' ? 'selected' : ''}`}
                        onClick={() => setColumnFolder('unassigned')}
                      >
                        <Music size={13} />
                        <span className="finder-col-title">Unassigned</span>
                        <span className="finder-col-versions-pill">
                          {
                            workspaceFamilies.filter((v) => {
                              const f = v[0].family ?? v[0].id;
                              const h = v.find((s) => s.id === selected[f]) ?? v[0];
                              return !h.album_id;
                            }).length
                          }
                        </span>
                      </button>
                      {albums.map((alb) => {
                        const folderKey = `album:${alb.id}`;
                        const count = workspaceFamilies.filter((v) => {
                          const f = v[0].family ?? v[0].id;
                          const h = v.find((s) => s.id === selected[f]) ?? v[0];
                          return h.album_id === alb.id;
                        }).length;
                        return (
                          <button
                            key={alb.id}
                            type="button"
                            className={`finder-col-item ${columnFolder === folderKey ? 'selected' : ''}`}
                            onClick={() => setColumnFolder(folderKey)}
                          >
                            <Disc3 size={13} />
                            <span className="finder-col-title">{alb.title}</span>
                            <span className="finder-col-versions-pill">{count}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Column 2: Tracks in Folder */}
                    <div className="finder-col-pane finder-col-tracks">
                      <div className="finder-col-header">
                        TRACKS ({filteredSortedFamilies.length})
                      </div>
                      {filteredSortedFamilies.length === 0 ? (
                        <div className="finder-col-empty">No drafts in this folder</div>
                      ) : (
                        filteredSortedFamilies.map((versions) => {
                          const famKey = versions[0].family ?? versions[0].id;
                          const isSelectedFam =
                            (inspectedFamily?.[0]?.family ?? inspectedFamily?.[0]?.id) === famKey;
                          return (
                            <Fragment key={famKey}>
                              {renderDraftItem(versions, true, 'columns', false)}
                              {isSelectedFam && (
                                <div className="finder-mobile-inline-inspector">
                                  {renderDraftItem(versions, true, 'grid', false)}
                                </div>
                              )}
                            </Fragment>
                          );
                        })
                      )}
                    </div>

                    {/* Column 3: Inspector Pane (Desktop) */}
                    <div className="finder-col-pane finder-inspector-pane">
                      <div className="finder-col-header">HIGHLIGHT</div>
                      {!inspectedFamily ? (
                        <div className="finder-col-empty">Select a draft to inspect</div>
                      ) : (
                        <div className="finder-inspector-body">
                          {renderDraftItem(inspectedFamily, true, 'grid', false)}
                        </div>
                      )}
                    </div>
                  </div>
                ) : finderView === 'list' ? (
                  /* macOS Finder List View */
                  <div className="finder-list-table" role="table" aria-label="Workspace drafts">
                    <div className="finder-list-header" role="row">
                      <div className="finder-list-th finder-cell-main" role="columnheader">
                        TITLE
                      </div>
                      <div className="finder-list-th finder-cell-album" role="columnheader">
                        ALBUM
                      </div>
                      <div className="finder-list-th finder-cell-genre" role="columnheader">
                        GENRE
                      </div>
                      <div className="finder-list-th finder-cell-duration" role="columnheader">
                        TIME
                      </div>
                      <div className="finder-list-th finder-cell-date" role="columnheader">
                        MODIFIED
                      </div>
                      <div className="finder-list-th finder-cell-actions" role="columnheader">
                        ACTIONS
                      </div>
                    </div>
                    <div className="finder-list-body" role="rowgroup">
                      {filteredSortedFamilies.map((versions) =>
                        renderDraftItem(versions, true, 'list', false)
                      )}
                    </div>
                  </div>
                ) : songSort === 'date' ? (
                  <div className="mypage-horizons-stack">
                    {horizonFolds.map((horizon) => {
                      const isHorizonCollapsed = Boolean(collapsedHorizons[horizon.key]);
                      const horizonEdits = horizon.families.reduce(
                        (sum, v) => sum + Math.max(0, v.length - 1),
                        0
                      );
                      return (
                        <div key={horizon.key} className="mypage-horizon-group">
                          <button
                            type="button"
                            className={`mypage-horizon-header ${isHorizonCollapsed ? 'collapsed' : ''}`}
                            onClick={() =>
                              setCollapsedHorizons((prev) => ({
                                ...prev,
                                [horizon.key]: !prev[horizon.key],
                              }))
                            }
                            aria-expanded={!isHorizonCollapsed}
                          >
                            <ChevronDown size={12} className="board-section-chevron" />
                            <span className="mypage-horizon-label">{horizon.label}</span>
                            <span className="board-section-badge">{horizon.families.length}</span>
                            {horizonEdits > 0 && (
                              <span className="mypage-horizon-edits-badge">
                                <GitBranch size={10} />
                                <span>{horizonEdits}</span>
                              </span>
                            )}
                          </button>

                          {!isHorizonCollapsed && (
                            <div className="market-grid">
                              {horizon.families.map((versions) =>
                                renderDraftItem(versions, true, 'grid', false)
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="market-grid">
                    {filteredSortedFamilies.map((versions) =>
                      renderDraftItem(versions, true, 'grid', false)
                    )}
                  </div>
                )}

                {hasMoreSongs && (
                  <div className="mypage-load-more-row">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleLoadMoreSongs}
                      disabled={loadingMoreSongs}
                    >
                      {loadingMoreSongs ? 'LOADING…' : 'LOAD MORE'}
                    </Button>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="market-stage-peek-cue"
                onClick={() => scrollToWorkspaceStage('licenses')}
              >
                <span className="market-stage-peek-num">02 //</span>
                <span className="market-stage-peek-label">
                  MY LICENSES ({totalLicensesCount})
                </span>
                <ChevronDown size={11} />
              </button>
            </div>
          </section>

          {/* STAGE 02: MY LICENSES (Licenses & Remixes) */}
          <section
            ref={stageLicensesRef}
            className="workspace-snap-stage"
            data-stage="licenses"
            aria-label="My Licenses"
          >
            <div className="mypage-section workspace-stage-panel">
              <div
                className="board-section-separator workspace-stage-header"
                data-guide="workspace.licenses-heading"
              >
                <div className="board-section-left">
                  <span className="market-stage-num">02</span>
                  <KeyRound size={12} />
                  <span className="mypage-section-title">MY LICENSES</span>
                  <span className="board-section-badge">{totalLicensesCount}</span>
                </div>

                {totalLicensesCount > 0 && (
                  <div
                    className="board-section-actions mypage-header-controls"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <div className={`mypage-header-search ${licenseSearch ? 'expanded' : ''}`}>
                      <button
                        type="button"
                        className="mypage-header-search-toggle"
                        aria-label="Search licenses"
                      >
                        <Search size={12} />
                      </button>
                      <input
                        type="text"
                        className="mypage-header-search-input"
                        placeholder="Search licenses..."
                        value={licenseSearch}
                        onChange={(e) => setLicenseSearch(e.target.value)}
                      />
                      {licenseSearch && (
                        <button
                          type="button"
                          className="mypage-header-search-clear"
                          onClick={() => setLicenseSearch('')}
                          aria-label="Clear search"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="mypage-section-body workspace-stage-content">
                {(publicSongsError || licensed.error) && (
                  <div role="alert">{(publicSongsError || licensed.error)?.message}</div>
                )}
                {totalLicensesCount === 0 ? (
                  <div className="mypage-empty">
                    <span className="mypage-empty-title">
                      {licensed.loading ? 'LOADING LICENSES…' : 'NO LICENSES PURCHASED'}
                    </span>
                    <span className="mypage-empty-desc">
                      {licensed.loading
                        ? 'Retrieving your on-chain licenses…'
                        : 'Licenses you purchase in the Market will appear here for remixing and stem extraction.'}
                    </span>
                  </div>
                ) : filteredRemixSongs.length === 0 &&
                  filteredUnforkedLicensedSongs.length === 0 ? (
                  <div className="mypage-empty">
                    <span className="mypage-empty-title">NO MATCHING LICENSES</span>
                  </div>
                ) : (
                  <div className="market-grid">
                    {groupSongs(filteredRemixSongs).map((versions) =>
                      renderDraftItem(versions, true, 'grid', false)
                    )}
                    {groupSongs(filteredUnforkedLicensedSongs).map((versions) =>
                      renderDraftItem(versions, false, 'grid', true)
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                className="market-stage-peek-cue"
                onClick={() => scrollToWorkspaceStage('catalog')}
              >
                <span className="market-stage-peek-num">03 //</span>
                <span className="market-stage-peek-label">
                  CATALOG ({albums.length + myPlaylists.length + voices.length})
                </span>
                <ChevronDown size={11} />
              </button>
            </div>
          </section>

          {/* CATALOG (3-Column Studio Rack: Albums, Playlists, Voices) */}
          <section
            ref={stageCatalogRef}
            className="workspace-snap-stage"
            data-stage="catalog"
            aria-label="Catalog and Voices"
          >
            <div className="mypage-section workspace-stage-panel workspace-catalog-stage">
              <div className="board-section-separator workspace-stage-header">
                <div className="board-section-left">
                  <span className="market-stage-num">03</span>
                  <Layers size={12} />
                  <span className="mypage-section-title">CATALOG</span>
                  <span className="board-section-badge">
                    {albums.length + myPlaylists.length + voices.length}
                  </span>
                </div>

                {/* Mobile Sub-Tab Switcher for 3-Column Studio Rack */}
                <div
                  className="market-pulse-mobile-tabs workspace-catalog-mobile-tabs"
                  role="tablist"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={catalogMobileTab === 'albums'}
                    aria-label={`Albums (${albums.length})`}
                    className={`market-pulse-mobile-tab ${catalogMobileTab === 'albums' ? 'active' : ''}`}
                    onClick={() => setCatalogMobileTab('albums')}
                  >
                    <Disc3 size={11} />
                    <span className="workspace-catalog-tab-label">ALBUMS ({albums.length})</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={catalogMobileTab === 'playlists'}
                    aria-label={`Playlists (${myPlaylists.length})`}
                    className={`market-pulse-mobile-tab ${catalogMobileTab === 'playlists' ? 'active' : ''}`}
                    onClick={() => setCatalogMobileTab('playlists')}
                  >
                    <ListMusic size={11} />
                    <span className="workspace-catalog-tab-label">PLAYLISTS ({myPlaylists.length})</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={catalogMobileTab === 'voices'}
                    aria-label={`Voices (${voices.length})`}
                    className={`market-pulse-mobile-tab ${catalogMobileTab === 'voices' ? 'active' : ''}`}
                    onClick={() => setCatalogMobileTab('voices')}
                  >
                    <Mic2 size={11} />
                    <span className="workspace-catalog-tab-label">VOICES ({voices.length})</span>
                  </button>
                </div>
              </div>

              <div className="workspace-catalog-rack">
                {/* COLUMN 1: MY ALBUMS */}
                <div
                  className={`workspace-rack-col ${catalogMobileTab === 'albums' ? 'mobile-active' : ''}`}
                >
                  <div className="workspace-rack-header" data-guide="workspace.albums-heading">
                    <div className="workspace-rack-title">
                      <Disc3 size={12} />
                      <span>MY ALBUMS</span>
                      <span className="board-section-badge">{albums.length}</span>
                    </div>
                    {activeAddress && (
                      <Tooltip title="Create Album in Album Studio">
                        <button
                          type="button"
                          className="mypage-header-icon-btn"
                          onClick={() => {
                            setEditingAlbum(null);
                            setAlbumStudioOpen(true);
                          }}
                          aria-label="New album"
                        >
                          <Plus size={12} />
                        </button>
                      </Tooltip>
                    )}
                  </div>

                  <div className="workspace-rack-body">
                    {loadingAlbums ? (
                      <div className="mypage-empty">
                        <span className="mypage-empty-title">LOADING ALBUMS...</span>
                      </div>
                    ) : albums.length === 0 ? (
                      <div className="mypage-empty">
                        <span className="mypage-empty-title">NO ALBUMS CREATED YET</span>
                        <span className="mypage-empty-desc">
                          Bundle tracks with AI cover art, liner notes, and visual booklet plates.
                        </span>
                        {activeAddress && (
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => {
                              setEditingAlbum(null);
                              setAlbumStudioOpen(true);
                            }}
                          >
                            <Plus size={11} />
                            <span>NEW ALBUM</span>
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="market-grid workspace-rack-grid">
                        {albums.map((album) => {
                          const resolvedSongs = state.songs.filter((s) => s.album_id === album.id);
                          const cover =
                            album.cover && album.cover.trim() !== ''
                              ? album.cover
                              : resolvedSongs[0]?.image || '';
                          const isExpanded = expandedAlbumId === album.id;
                          const isPlayingAlb =
                            state.isPlaying && state.activePlaylistId === album.id;
                          const isToggling = togglingAlbumId === album.id;
                          const galleryCount = Array.isArray(album.gallery)
                            ? album.gallery.length
                            : 0;

                          return (
                            <div
                              key={album.id}
                              className="market-collection-card"
                              onClick={() => setExpandedAlbumId(isExpanded ? null : album.id)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setExpandedAlbumId(isExpanded ? null : album.id);
                                }
                              }}
                            >
                              <div className={`market-collection-media ${!cover ? 'is-logo' : ''}`}>
                                <img
                                  src={cover || '/branding/mark.svg'}
                                  alt={album.title}
                                  loading="lazy"
                                  decoding="async"
                                />

                                <button
                                  type="button"
                                  className={`market-collection-vis-btn ${album.public ? 'public' : 'private'}`}
                                  disabled={isToggling}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleToggleAlbumPublic(album);
                                  }}
                                  title={
                                    album.public
                                      ? 'Public · Click to make Private'
                                      : 'Private · Click to make Public'
                                  }
                                  aria-label={`Toggle visibility, currently ${album.public ? 'Public' : 'Private'}`}
                                >
                                  {album.public ? <Globe size={11} /> : <Lock size={11} />}
                                </button>

                                <button
                                  type="button"
                                  className="market-collection-edit-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingAlbum(album);
                                    setAlbumStudioOpen(true);
                                  }}
                                  title="Edit Album Studio (Cover, Concept, Booklet)"
                                  aria-label={`Edit album ${album.title}`}
                                >
                                  <Pencil size={11} />
                                </button>

                                <button
                                  type="button"
                                  className="market-collection-delete-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDeleteAlbum(album);
                                  }}
                                  title="Delete Album"
                                  aria-label={`Delete album ${album.title}`}
                                >
                                  <Trash2 size={11} />
                                </button>

                                <button
                                  type="button"
                                  className={`market-collection-play-btn ${isPlayingAlb ? 'playing' : ''}`}
                                  disabled={resolvedSongs.length === 0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePlayMyAlbum(album);
                                  }}
                                  aria-label={
                                    isPlayingAlb ? `Pause ${album.title}` : `Play ${album.title}`
                                  }
                                >
                                  {isPlayingAlb ? <Pause size={14} /> : <Play size={14} />}
                                </button>
                              </div>

                              <div className="market-collection-body">
                                <div className="market-collection-title" title={album.title}>
                                  {album.title}
                                </div>

                                <div className="market-collection-meta">
                                  <Music size={10} />
                                  <span>{resolvedSongs.length}</span>
                                  {album.genre && (
                                    <>
                                      <span>•</span>
                                      <GenreBadges
                                        genres={album.genre
                                          .split(',')
                                          .map((g) => g.trim())
                                          .filter(Boolean)}
                                      />
                                    </>
                                  )}
                                  {galleryCount > 0 && (
                                    <>
                                      <span>•</span>
                                      <ImageIcon size={10} />
                                      <span>{galleryCount}</span>
                                    </>
                                  )}
                                  {resolvedSongs.length > 0 && (
                                    <ChevronDown size={11} className="market-popover-chevron" />
                                  )}
                                </div>

                                {isExpanded && (
                                  <div
                                    className="market-playlist-tracklist"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {(album.description || album.concept) && (
                                      <div className="album-expanded-concept">
                                        {album.description || album.concept}
                                      </div>
                                    )}
                                    {resolvedSongs.map((s, idx) => {
                                      const isPlayingTrack =
                                        state.isPlaying && state.activeSong?.id === s.id;
                                      return (
                                        <div
                                          key={`${s.id}-${idx}`}
                                          className="market-playlist-track-row-wrap"
                                        >
                                          <button
                                            type="button"
                                            className={`market-playlist-track-row ${isPlayingTrack ? 'active' : ''}`}
                                            onClick={() =>
                                              store.playSong(s, resolvedSongs, album.id)
                                            }
                                          >
                                            <span className="market-playlist-track-idx">
                                              {idx + 1}
                                            </span>
                                            <span className="market-playlist-track-name">
                                              {s.title}
                                            </span>
                                          </button>
                                          <button
                                            type="button"
                                            className="market-playlist-track-remove-btn"
                                            onClick={() =>
                                              void handleRemoveAlbumSong(album.id, s.id)
                                            }
                                            aria-label={`Remove ${s.title}`}
                                          >
                                            <Trash2 size={11} />
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* COLUMN 2: MY PLAYLISTS */}
                <div
                  className={`workspace-rack-col ${catalogMobileTab === 'playlists' ? 'mobile-active' : ''}`}
                >
                  <div className="workspace-rack-header">
                    <div className="workspace-rack-title">
                      <ListMusic size={12} />
                      <span>MY PLAYLISTS</span>
                      <span className="board-section-badge">{myPlaylists.length}</span>
                    </div>

                    <div
                      className="mypage-header-controls"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {activeAddress && (
                        <>
                          {showCreatePlaylistInput ? (
                            <form
                              className="mypage-header-inline-create"
                              onSubmit={handleCreatePlaylist}
                            >
                              <input
                                type="text"
                                className="mypage-header-search-input"
                                placeholder="Playlist title..."
                                value={newPlaylistName}
                                onChange={(e) => setNewPlaylistName(e.target.value)}
                                maxLength={80}
                                autoFocus
                              />
                              <button
                                type="submit"
                                className="mypage-header-icon-btn primary"
                                disabled={creatingPlaylist || !newPlaylistName.trim()}
                                aria-label="Create playlist"
                              >
                                <Check size={12} />
                              </button>
                              <button
                                type="button"
                                className="mypage-header-icon-btn"
                                onClick={() => {
                                  setShowCreatePlaylistInput(false);
                                  setNewPlaylistName('');
                                }}
                                aria-label="Cancel"
                              >
                                <X size={12} />
                              </button>
                            </form>
                          ) : (
                            <Tooltip title="New Playlist">
                              <button
                                type="button"
                                className="mypage-header-icon-btn"
                                onClick={() => setShowCreatePlaylistInput(true)}
                                aria-label="New playlist"
                              >
                                <Plus size={12} />
                              </button>
                            </Tooltip>
                          )}
                        </>
                      )}

                      <div className="market-page-stepper">
                        <button
                          type="button"
                          className="market-stepper-btn"
                          disabled={clampedMyPlaylistPage <= 0}
                          onClick={() => setMyPlaylistPage((p) => Math.max(0, p - 1))}
                          aria-label="Previous playlists page"
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <span className="market-stepper-label">
                          {clampedMyPlaylistPage + 1}/{myPlaylistTotalPages}
                        </span>
                        <button
                          type="button"
                          className="market-stepper-btn"
                          disabled={clampedMyPlaylistPage >= myPlaylistTotalPages - 1}
                          onClick={() =>
                            setMyPlaylistPage((p) => Math.min(myPlaylistTotalPages - 1, p + 1))
                          }
                          aria-label="Next playlists page"
                        >
                          <ChevronRight size={12} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="workspace-rack-body">
                    <div className="market-playlists-crate-grid">
                      {/* Pinned Top: LIKED TRACKS */}
                      <div className="mypage-liked-crate-wrap">
                        <div
                          className={`market-liked-crate ${state.isPlaying && state.activeContextId === 'liked-crate' && !state.activePlaylistId ? 'is-playing' : ''}`}
                          onClick={() =>
                            setExpandedPlaylistId(
                              expandedPlaylistId === 'liked-tracks' ? null : 'liked-tracks'
                            )
                          }
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setExpandedPlaylistId(
                                expandedPlaylistId === 'liked-tracks' ? null : 'liked-tracks'
                              );
                            }
                          }}
                        >
                          <div className="market-liked-crate-icon">
                            <Heart size={18} fill="currentColor" />
                          </div>
                          <div className="market-liked-crate-info">
                            <span className="market-liked-crate-title">LIKED TRACKS</span>
                            <span className="market-liked-crate-meta">
                              {likedSongs.length} SAVED
                            </span>
                          </div>
                          <button
                            type="button"
                            className={`market-collection-play-btn ${state.isPlaying && state.activeContextId === 'liked-crate' && !state.activePlaylistId ? 'playing' : ''}`}
                            disabled={likedSongs.length === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (likedSongs.length > 0) {
                                void store.playCollection(likedSongs, 'liked-crate', null);
                              }
                            }}
                            aria-label="Play Liked Tracks"
                          >
                            {state.isPlaying && state.activeContextId === 'liked-crate' && !state.activePlaylistId ? (
                              <Pause size={13} />
                            ) : (
                              <Play size={13} />
                            )}
                          </button>
                        </div>

                        {expandedPlaylistId === 'liked-tracks' && likedSongs.length > 0 && (
                          <div
                            className="finder-col-pane playlist-columns-expansion"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {likedSongs.map((s, idx) => {
                              const isPlayingTrack =
                                state.isPlaying &&
                                state.activeSong?.id === s.id &&
                                state.activeContextId === 'liked-crate' &&
                                !state.activePlaylistId;
                              const thumbSrc =
                                s.image && s.image.trim() !== '' ? s.image : '/branding/mark.svg';
                              const isFallbackThumb = thumbSrc === '/branding/mark.svg';
                              return (
                                <div
                                  key={`${s.id}-${idx}`}
                                  className={`finder-col-item ${isPlayingTrack ? 'playing' : ''}`}
                                  onClick={() => {
                                    void store.playSong(s, likedSongs, null, 'liked-crate');
                                  }}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      void store.playSong(s, likedSongs, null, 'liked-crate');
                                    }
                                  }}
                                >
                                  <img
                                    src={thumbSrc}
                                    alt={s.title}
                                    className={`finder-col-thumb ${isFallbackThumb ? 'fallback' : ''}`}
                                    loading="lazy"
                                  />
                                  <span className="finder-col-title" title={s.title}>
                                    {s.title}
                                  </span>
                                  <button
                                    type="button"
                                    className="market-playlist-track-remove-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void toggleLike(s.id, e);
                                    }}
                                    aria-label={`Unlike ${s.title}`}
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {loadingPlaylists ? (
                        <div className="mypage-empty">
                          <span className="mypage-empty-title">LOADING...</span>
                        </div>
                      ) : visibleMyPlaylists.length === 0 ? (
                        <div className="mypage-empty">
                          <span className="mypage-empty-title">NO PLAYLISTS YET</span>
                          <span className="mypage-empty-desc">
                            Curate private or public playlists from your catalog and Market tracks.
                          </span>
                        </div>
                      ) : (
                        visibleMyPlaylists.map((playlist) => {
                          const resolvedSongs = (playlist.song_ids || [])
                            .map((id) => allKnownSongsById.get(id))
                            .filter((s): s is Song => Boolean(s));
                          const cover =
                            playlist.cover && playlist.cover.trim() !== ''
                              ? playlist.cover
                              : resolvedSongs[0]?.image || '/branding/mark.svg';
                          const isExpanded = expandedPlaylistId === playlist.id;
                          const isPlayingPl =
                            state.isPlaying &&
                            (state.activePlaylistId === playlist.id ||
                              state.activeContextId === `playlist:${playlist.id}`);
                          const isToggling = togglingPlaylistId === playlist.id;

                          return (
                            <div
                              key={playlist.id}
                              className={`market-crate-playlist-card ${isExpanded ? 'is-expanded' : ''}`}
                              onClick={() => setExpandedPlaylistId(isExpanded ? null : playlist.id)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setExpandedPlaylistId(isExpanded ? null : playlist.id);
                                }
                              }}
                            >
                              <div className="market-crate-playlist-top">
                                <img
                                  src={cover}
                                  alt={playlist.title}
                                  className="market-crate-playlist-cover"
                                  loading="lazy"
                                  decoding="async"
                                />
                                <div className="market-crate-playlist-info">
                                  <span className="market-crate-playlist-title" title={playlist.title}>
                                    {playlist.title}
                                  </span>
                                  <span className="market-crate-playlist-meta">
                                    {(playlist.song_ids || []).length} TRACKS • {playlist.plays ?? 0} PLAYS
                                  </span>
                                </div>
                                <div className="market-crate-playlist-actions">
                                  <button
                                    type="button"
                                    className={`market-crate-vis-btn ${playlist.public ? 'public' : 'private'}`}
                                    disabled={isToggling}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleTogglePlaylistPublic(playlist);
                                    }}
                                    title={
                                      playlist.public
                                        ? 'Public · Click to make Private'
                                        : 'Private · Click to make Public'
                                    }
                                    aria-label={`Toggle visibility, currently ${playlist.public ? 'Public' : 'Private'}`}
                                  >
                                    {playlist.public ? <Globe size={11} /> : <Lock size={11} />}
                                  </button>

                                  <button
                                    type="button"
                                    className="market-crate-delete-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleDeletePlaylist(playlist);
                                    }}
                                    title="Delete Playlist"
                                    aria-label={`Delete playlist ${playlist.title}`}
                                  >
                                    <Trash2 size={11} />
                                  </button>

                                  <button
                                    type="button"
                                    className={`market-collection-play-btn ${isPlayingPl ? 'playing' : ''}`}
                                    disabled={resolvedSongs.length === 0}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePlayMyPlaylist(playlist);
                                    }}
                                    aria-label={
                                      isPlayingPl
                                        ? `Pause ${playlist.title}`
                                        : `Play ${playlist.title}`
                                    }
                                  >
                                    {isPlayingPl ? <Pause size={13} /> : <Play size={13} />}
                                  </button>
                                </div>
                              </div>

                              {isExpanded && resolvedSongs.length > 0 && (
                                <div
                                  className="finder-col-pane playlist-columns-expansion"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {resolvedSongs.map((s, idx) => {
                                    const isPlayingTrack =
                                      state.isPlaying &&
                                      state.activeSong?.id === s.id &&
                                      (state.activePlaylistId === playlist.id ||
                                        state.activeContextId === `playlist:${playlist.id}`);
                                    const thumbSrc =
                                      s.image && s.image.trim() !== ''
                                        ? s.image
                                        : '/branding/mark.svg';
                                    const isFallbackThumb = thumbSrc === '/branding/mark.svg';
                                    return (
                                      <div
                                        key={`${s.id}-${idx}`}
                                        className={`finder-col-item ${isPlayingTrack ? 'playing' : ''}`}
                                        onClick={() => {
                                          void store.playSong(
                                            s,
                                            resolvedSongs,
                                            playlist.id,
                                            `playlist:${playlist.id}`
                                          );
                                        }}
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            void store.playSong(
                                              s,
                                              resolvedSongs,
                                              playlist.id,
                                              `playlist:${playlist.id}`
                                            );
                                          }
                                        }}
                                      >
                                        <img
                                          src={thumbSrc}
                                          alt={s.title}
                                          className={`finder-col-thumb ${isFallbackThumb ? 'fallback' : ''}`}
                                          loading="lazy"
                                        />
                                        <span className="finder-col-title" title={s.title}>
                                          {s.title}
                                        </span>
                                        <button
                                          type="button"
                                          className="market-playlist-track-remove-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleRemovePlaylistSong(playlist.id, s.id);
                                          }}
                                          aria-label={`Remove ${s.title}`}
                                        >
                                          <Trash2 size={11} />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* COLUMN 3: MY VOICES */}
                <div
                  className={`workspace-rack-col ${catalogMobileTab === 'voices' ? 'mobile-active' : ''}`}
                >
                  <div className="workspace-rack-header" data-guide="workspace.voices-heading">
                    <div className="workspace-rack-title">
                      <Mic2 size={12} />
                      <span>MY VOICES</span>
                      <span className="board-section-badge">{voices.length}</span>
                    </div>
                  </div>

                  <div className="workspace-rack-body">
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
                          Attach a vocal sample in the Studio or save a voice from one of your
                          songs.
                        </span>
                      </div>
                    ) : (
                      <div className="market-grid workspace-rack-grid">
                        {voices.map((voice) => {
                          const voiceUrl = resolveVoiceAudioUrl(voice);
                          const voiceSongId = `voice:${voice.id}`;
                          const isPlayingVoice =
                            state.isPlaying && state.activeSong?.id === voiceSongId;
                          const isLoadingVoice = loadingVoiceId === voice.id;
                          const sourceSongId =
                            typeof voice.metadata?.source_song_id === 'string'
                              ? voice.metadata.source_song_id.trim()
                              : '';
                          const sourceSong = sourceSongId
                            ? allKnownSongsById.get(sourceSongId)
                            : undefined;
                          const cover = sourceSong?.image || '';

                          return (
                            <div key={voice.id} className="market-collection-card">
                              <div className={`market-collection-media ${!cover ? 'is-logo' : ''}`}>
                                <img
                                  src={cover || '/branding/mark.svg'}
                                  alt={voice.name}
                                  loading="lazy"
                                  decoding="async"
                                />

                                {voice.status !== 'ready' && (
                                  <div className="mypage-voice-status-badge">
                                    <Badge
                                      variant={voice.status === 'error' ? 'warning' : 'default'}
                                    >
                                      {voiceStatus(voice).toUpperCase()}
                                    </Badge>
                                  </div>
                                )}

                                <button
                                  type="button"
                                  className={`market-collection-play-btn ${isPlayingVoice ? 'playing' : ''}`}
                                  disabled={!voiceUrl || isLoadingVoice}
                                  onClick={() => void handlePlayVoice(voice)}
                                  aria-label={
                                    isPlayingVoice ? `Pause ${voice.name}` : `Play ${voice.name}`
                                  }
                                >
                                  {isPlayingVoice ? <Pause size={14} /> : <Play size={14} />}
                                </button>
                              </div>

                              <div className="market-collection-body">
                                <div className="market-collection-title" title={voice.name}>
                                  {voice.name}
                                </div>

                                {(['turbo', 'sft'] as const).map((mode) => {
                                  const availability = voice.availability[mode];
                                  return availability.step != null &&
                                    ['queued', 'training'].includes(availability.status) ? (
                                    <div key={mode} className="studio-voice-detail">
                                      {mode === 'turbo' ? 'Fast' : 'Master'}: {availability.step}
                                      {availability.total_steps != null
                                        ? `/${availability.total_steps}`
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

                                <div className="market-collection-meta">
                                  <Mic2 size={10} />
                                  <span>{new Date(voice.created_at).toLocaleDateString()}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="market-stage-peek-cue"
                onClick={() => scrollToWorkspaceStage('songs')}
              >
                <span className="market-stage-peek-num">01 //</span>
                <span className="market-stage-peek-label">
                  RETURN TO MY SONGS ({filteredSortedFamilies.length})
                </span>
                <ChevronDown size={11} style={{ transform: 'rotate(180deg)' }} />
              </button>
            </div>
          </section>
        </div>
      ) : (
        /* EARN TAB: Published Catalog, Licenses & On-Chain x402 Streaming Analytics */
        <div className="earn-dashboard" data-guide="mypage-sections">
          {/* Unified Top Filter & KPI Bar (persistent across LIST <> CHARTS transitions) */}
          {publishedSongsList.length > 0 && (
            <>
              <div
                className={`earn-toolbar ${mobileSearchOpen || Boolean(songSearch) ? 'search-open' : ''}`}
              >
                {/* Network Filter Dropdown (ALL | BASE | SOLANA | TEMPO) - Pinned Far Left */}
                <div className="market-view-select-wrap">
                  <Tooltip
                    title="Network Filter"
                    description={
                      earnNetworkFilter === 'all'
                        ? 'ALL'
                        : earnNetworkFilter.toUpperCase()
                    }
                  >
                    <button
                      type="button"
                      className={`mypage-header-trigger ${earnNetDropdownOpen ? 'open' : ''}`}
                      onClick={() => {
                        setEarnSortDropdownOpen(false);
                        setEarnViewDropdownOpen(false);
                        setEarnSourceDropdownOpen(false);
                        setEarnDateDropdownOpen(false);
                        setEarnStatDropdownOpen(false);
                        setEarnNetDropdownOpen((prev) => !prev);
                      }}
                      aria-haspopup="listbox"
                      aria-expanded={earnNetDropdownOpen}
                      aria-label="Filter revenue by network"
                    >
                      {earnNetworkFilter === 'all' ? (
                        <Globe size={12} />
                      ) : (
                        <img
                          src={getNetworkLogo(earnNetworkFilter) || ''}
                          alt=""
                          className="earn-net-logo"
                        />
                      )}
                      <span className="mypage-dropdown-label">
                        {earnNetworkFilter === 'all'
                          ? 'ALL'
                          : earnNetworkFilter.toUpperCase()}
                      </span>
                      <ChevronDown size={11} className="market-popover-chevron" />
                    </button>
                  </Tooltip>

                  {earnNetDropdownOpen && (
                    <div className="market-popover-menu mypage-header-popover">
                      <div className="market-popover-list" role="listbox">
                        <button
                          type="button"
                          role="option"
                          aria-selected={earnNetworkFilter === 'all'}
                          className={`market-popover-option ${earnNetworkFilter === 'all' ? 'selected' : ''}`}
                          onClick={() => {
                            setEarnNetworkFilter('all');
                            setEarnNetDropdownOpen(false);
                          }}
                        >
                          <Globe size={12} />
                          <span>ALL</span>
                        </button>
                        {(['base', 'solana', 'tempo'] as const).map((netKey) => {
                          const label =
                            netKey === 'base' ? 'BASE' : netKey === 'tempo' ? 'TEMPO' : 'SOLANA';
                          const logo = getNetworkLogo(netKey);
                          return (
                            <button
                              key={netKey}
                              type="button"
                              role="option"
                              aria-selected={earnNetworkFilter === netKey}
                              className={`market-popover-option ${earnNetworkFilter === netKey ? 'selected' : ''}`}
                              onClick={() => {
                                setEarnNetworkFilter(netKey);
                                setEarnNetDropdownOpen(false);
                              }}
                            >
                              {logo && <img src={logo} alt="" className="earn-net-logo" />}
                              <span>{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Progressive Responsive KPI Strip (Desktop: all 5 inline; Intermediate: 3 inline + overflow; Mobile: compact dropdown) */}
                <div
                  className="earn-kpi-inline-strip"
                  role="group"
                  aria-label="Creator earnings and streaming metrics"
                >
                  {earnKpiItems.map((item) => {
                    const ItemIcon = item.icon;
                    const isPrimaryTier =
                      item.id === 'profit' || item.id === 'plays' || item.id === 'streamed';
                    const isActive = earnSelectedStat === item.id;
                    return (
                      <Tooltip key={item.id} title={item.label} description={item.tooltip}>
                        <button
                          type="button"
                          className={`earn-kpi-inline-pill ${isPrimaryTier ? 'tier-primary' : 'tier-secondary'} ${isActive ? 'active' : ''}`}
                          onClick={() => handleSelectEarnStat(item.id)}
                          aria-pressed={isActive}
                        >
                          <ItemIcon size={11} className="earn-kpi-icon" />
                          <span className="earn-kpi-label">{item.label}</span>
                          <span className="earn-kpi-value">{item.value}</span>
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>

                {/* Intermediate Overflow Dropdown (861px–1120px: AVG RATIO & LICENSES) */}
                <div className="market-view-select-wrap earn-kpi-overflow-wrap">
                  {(() => {
                    const activeSecondary =
                      secondaryEarnKpis.find((k) => k.id === earnSelectedStat) ??
                      secondaryEarnKpis[0];
                    const SecIcon = activeSecondary.icon;
                    const isSecondaryActive =
                      earnSelectedStat === 'ratio' || earnSelectedStat === 'licenses';
                    return (
                      <Tooltip
                        title={activeSecondary.label}
                        description={activeSecondary.tooltip}
                      >
                        <button
                          type="button"
                          className={`mypage-header-trigger earn-kpi-trigger ${isSecondaryActive ? 'active' : ''} ${earnStatDropdownOpen ? 'open' : ''}`}
                          onClick={() => {
                            setEarnNetDropdownOpen(false);
                            setEarnSortDropdownOpen(false);
                            setEarnViewDropdownOpen(false);
                            setEarnSourceDropdownOpen(false);
                            setEarnDateDropdownOpen(false);
                            setEarnStatDropdownOpen((prev) => !prev);
                          }}
                          aria-haspopup="listbox"
                          aria-expanded={earnStatDropdownOpen}
                          aria-label="More earnings stats"
                        >
                          <SecIcon size={11} className="earn-kpi-icon" />
                          <span className="earn-kpi-label">{activeSecondary.label}</span>
                          <span className="earn-kpi-value">{activeSecondary.value}</span>
                          <ChevronDown size={11} className="market-popover-chevron" />
                        </button>
                      </Tooltip>
                    );
                  })()}

                  {earnStatDropdownOpen && (
                    <div className="market-popover-menu mypage-header-popover earn-kpi-popover">
                      <div className="market-popover-list" role="listbox">
                        {secondaryEarnKpis.map((item) => {
                          const ItemIcon = item.icon;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              role="option"
                              aria-selected={earnSelectedStat === item.id}
                              className={`market-popover-option earn-kpi-option ${earnSelectedStat === item.id ? 'selected' : ''}`}
                              onClick={() => handleSelectEarnStat(item.id)}
                            >
                              <span className="earn-kpi-opt-left">
                                <ItemIcon size={12} />
                                <span>{item.label}</span>
                              </span>
                              <span className="earn-kpi-opt-val">{item.value}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Compact KPI Stat Selector for Mobile & Small Tablet (<= 860px) */}
                <div className="market-view-select-wrap earn-kpi-select-wrap">
                  <Tooltip title={activeEarnKpi.label} description={activeEarnKpi.tooltip}>
                    <button
                      type="button"
                      className={`mypage-header-trigger earn-kpi-trigger ${earnStatDropdownOpen ? 'open' : ''}`}
                      onClick={() => {
                        setEarnNetDropdownOpen(false);
                        setEarnSortDropdownOpen(false);
                        setEarnViewDropdownOpen(false);
                        setEarnSourceDropdownOpen(false);
                        setEarnDateDropdownOpen(false);
                        setEarnStatDropdownOpen((prev) => !prev);
                      }}
                      aria-haspopup="listbox"
                      aria-expanded={earnStatDropdownOpen}
                      aria-label={`Selected metric: ${activeEarnKpi.label} ${activeEarnKpi.value}. Click for more stats`}
                    >
                      {(() => {
                        const ActiveIcon = activeEarnKpi.icon;
                        return <ActiveIcon size={11} className="earn-kpi-icon" />;
                      })()}
                      <span className="earn-kpi-label">{activeEarnKpi.label}</span>
                      <span className="earn-kpi-value">{activeEarnKpi.value}</span>
                      <ChevronDown size={11} className="market-popover-chevron" />
                    </button>
                  </Tooltip>

                  {earnStatDropdownOpen && (
                    <div className="market-popover-menu mypage-header-popover earn-kpi-popover">
                      <div className="market-popover-list" role="listbox">
                        {otherEarnKpis.map((item) => {
                          const ItemIcon = item.icon;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              role="option"
                              aria-selected={earnSelectedStat === item.id}
                              className="market-popover-option earn-kpi-option"
                              onClick={() => handleSelectEarnStat(item.id)}
                            >
                              <span className="earn-kpi-opt-left">
                                <ItemIcon size={12} />
                                <span>{item.label}</span>
                              </span>
                              <span className="earn-kpi-opt-val">{item.value}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* CHARTS Mode Filters: Revenue Source & Date Window */}
                {earnView === 'charts' && (
                  <>
                    {/* Source Filter Dropdown (ALL SOURCES | STREAMS | LICENSES) */}
                    <div className="market-view-select-wrap">
                      <Tooltip
                        title="Revenue Source"
                        description={
                          SOURCE_OPTIONS.find((o) => o.value === earnSourceFilter)?.label ??
                          'ALL SOURCES'
                        }
                      >
                        <button
                          type="button"
                          className={`mypage-header-trigger ${earnSourceDropdownOpen ? 'open' : ''}`}
                          onClick={() => {
                            setEarnNetDropdownOpen(false);
                            setEarnDateDropdownOpen(false);
                            setEarnViewDropdownOpen(false);
                            setEarnStatDropdownOpen(false);
                            setEarnSourceDropdownOpen((prev) => !prev);
                          }}
                          aria-haspopup="listbox"
                          aria-expanded={earnSourceDropdownOpen}
                          aria-label="Filter revenue source"
                        >
                          {earnSourceFilter === 'streams' ? (
                            <Headphones size={11} />
                          ) : earnSourceFilter === 'licenses' ? (
                            <KeyRound size={11} />
                          ) : (
                            <Layers size={11} />
                          )}
                          <span className="mypage-dropdown-label">
                            {SOURCE_OPTIONS.find((o) => o.value === earnSourceFilter)?.label ??
                              'ALL SOURCES'}
                          </span>
                          <ChevronDown size={11} className="market-popover-chevron" />
                        </button>
                      </Tooltip>

                      {earnSourceDropdownOpen && (
                        <div className="market-popover-menu mypage-header-popover">
                          <div className="market-popover-list" role="listbox">
                            {SOURCE_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                role="option"
                                aria-selected={earnSourceFilter === opt.value}
                                className={`market-popover-option ${earnSourceFilter === opt.value ? 'selected' : ''}`}
                                onClick={() => {
                                  setEarnSourceFilter(opt.value);
                                  setEarnSourceDropdownOpen(false);
                                }}
                              >
                                {opt.value === 'streams' ? (
                                  <Headphones size={12} />
                                ) : opt.value === 'licenses' ? (
                                  <KeyRound size={12} />
                                ) : (
                                  <Layers size={12} />
                                )}
                                <span>{opt.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Date Window Dropdown (LAST 24H | LAST 7D | LAST 30D | LAST 6M) */}
                    <div className="market-view-select-wrap">
                      <Tooltip
                        title="Time Horizon"
                        description={
                          DATE_WINDOW_OPTIONS.find((o) => o.value === earnDateWindow)?.label ??
                          'LAST 30D'
                        }
                      >
                        <button
                          type="button"
                          className={`mypage-header-trigger ${earnDateDropdownOpen ? 'open' : ''}`}
                          onClick={() => {
                            setEarnNetDropdownOpen(false);
                            setEarnSourceDropdownOpen(false);
                            setEarnViewDropdownOpen(false);
                            setEarnStatDropdownOpen(false);
                            setEarnDateDropdownOpen((prev) => !prev);
                          }}
                          aria-haspopup="listbox"
                          aria-expanded={earnDateDropdownOpen}
                          aria-label="Select chart time window"
                        >
                          <Calendar size={11} />
                          <span className="mypage-dropdown-label">
                            {DATE_WINDOW_OPTIONS.find((o) => o.value === earnDateWindow)?.label ??
                              'LAST 30D'}
                          </span>
                          <ChevronDown size={11} className="market-popover-chevron" />
                        </button>
                      </Tooltip>

                      {earnDateDropdownOpen && (
                        <div className="market-popover-menu mypage-header-popover">
                          <div className="market-popover-list" role="listbox">
                            {DATE_WINDOW_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                role="option"
                                aria-selected={earnDateWindow === opt.value}
                                className={`market-popover-option ${earnDateWindow === opt.value ? 'selected' : ''}`}
                                onClick={() => {
                                  setEarnDateWindow(opt.value);
                                  setEarnDateDropdownOpen(false);
                                }}
                              >
                                <Calendar size={12} />
                                <span>{opt.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                <div className="earn-toolbar-right">
                  {earnView === 'list' && (
                    <>
                      {/* Search inside Earn List */}
                      <div
                        className={`mypage-header-search ${mobileSearchOpen || Boolean(songSearch) ? 'expanded' : ''}`}
                      >
                        <Tooltip title="Search Releases">
                          <button
                            type="button"
                            className="mypage-header-search-toggle"
                            onClick={() => {
                              setMobileSearchOpen((prev) => {
                                const next = !prev;
                                if (next) {
                                  setTimeout(() => searchInputRef.current?.focus(), 0);
                                }
                                return next;
                              });
                            }}
                            aria-label="Search published tracks"
                          >
                            <Search size={12} />
                          </button>
                        </Tooltip>
                        <input
                          ref={searchInputRef}
                          type="text"
                          className="mypage-header-search-input"
                          placeholder="Search releases..."
                          value={songSearch}
                          onChange={(e) => setSongSearch(e.target.value)}
                        />
                        {(songSearch || mobileSearchOpen) && (
                          <button
                            type="button"
                            className="mypage-header-search-clear"
                            onClick={() => {
                              setSongSearch('');
                              setMobileSearchOpen(false);
                            }}
                            aria-label="Clear search"
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>

                      {/* Sort Dropdown (PROFIT | SOLD | PLAYS | RECENT) */}
                      <div className="market-view-select-wrap">
                        <Tooltip
                          title="Sort Releases"
                          description={
                            earnSort === 'profit'
                              ? 'PROFIT'
                              : earnSort === 'sold'
                                ? 'LICENSES SOLD'
                                : earnSort === 'plays'
                                  ? 'PLAYS'
                                  : 'RECENT'
                          }
                        >
                          <button
                            type="button"
                            className={`mypage-header-trigger ${earnSortDropdownOpen ? 'open' : ''}`}
                            onClick={() => {
                              setEarnNetDropdownOpen(false);
                              setEarnViewDropdownOpen(false);
                              setEarnStatDropdownOpen(false);
                              setEarnSortDropdownOpen((prev) => !prev);
                            }}
                            aria-haspopup="listbox"
                            aria-expanded={earnSortDropdownOpen}
                            aria-label="Sort published releases"
                          >
                            {earnSort === 'profit' ? (
                              <DollarSign size={11} />
                            ) : earnSort === 'sold' ? (
                              <Disc3 size={11} />
                            ) : earnSort === 'plays' ? (
                              <Headphones size={11} />
                            ) : (
                              <Clock size={11} />
                            )}
                            <span className="mypage-dropdown-label">
                              {earnSort === 'profit'
                                ? 'PROFIT'
                                : earnSort === 'sold'
                                  ? 'SOLD'
                                  : earnSort === 'plays'
                                    ? 'PLAYS'
                                    : 'RECENT'}
                            </span>
                            <ChevronDown size={11} className="market-popover-chevron" />
                          </button>
                        </Tooltip>

                        {earnSortDropdownOpen && (
                          <div className="market-popover-menu mypage-header-popover">
                            <div className="market-popover-list" role="listbox">
                              <button
                                type="button"
                                role="option"
                                aria-selected={earnSort === 'profit'}
                                className={`market-popover-option ${earnSort === 'profit' ? 'selected' : ''}`}
                                onClick={() => {
                                  setEarnSort('profit');
                                  setEarnSortDropdownOpen(false);
                                }}
                              >
                                <DollarSign size={12} />
                                <span>PROFIT</span>
                              </button>
                              <button
                                type="button"
                                role="option"
                                aria-selected={earnSort === 'sold'}
                                className={`market-popover-option ${earnSort === 'sold' ? 'selected' : ''}`}
                                onClick={() => {
                                  setEarnSort('sold');
                                  setEarnSortDropdownOpen(false);
                                }}
                              >
                                <Disc3 size={12} />
                                <span>LICENSES SOLD</span>
                              </button>
                              <button
                                type="button"
                                role="option"
                                aria-selected={earnSort === 'plays'}
                                className={`market-popover-option ${earnSort === 'plays' ? 'selected' : ''}`}
                                onClick={() => {
                                  setEarnSort('plays');
                                  setEarnSortDropdownOpen(false);
                                }}
                              >
                                <Headphones size={12} />
                                <span>PLAYS</span>
                              </button>
                              <button
                                type="button"
                                role="option"
                                aria-selected={earnSort === 'recent'}
                                className={`market-popover-option ${earnSort === 'recent' ? 'selected' : ''}`}
                                onClick={() => {
                                  setEarnSort('recent');
                                  setEarnSortDropdownOpen(false);
                                }}
                              >
                                <Clock size={12} />
                                <span>RECENT</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <Tooltip title="Sync On-Chain Revenue">
                    <button
                      type="button"
                      className="mypage-header-icon-btn"
                      onClick={() => void refetchEarnings()}
                      aria-label="Sync on-chain revenue"
                    >
                      <RotateCcw size={12} className={loadingEarnings ? 'spin-icon' : ''} />
                    </button>
                  </Tooltip>
                </div>
              </div>

              {/* Standalone Thin LISTS <> CHARTS View-Selector Bar Below Filters */}
              <div className="earn-view-bar" role="tablist" aria-label="Earn view mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={earnView === 'list'}
                  className={`earn-view-bar-tab ${earnView === 'list' ? 'active' : ''}`}
                  onClick={() => setEarnView('list')}
                >
                  <List size={11} />
                  <span>LISTS ({filteredEarnSongs.length})</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={earnView === 'charts'}
                  className={`earn-view-bar-tab ${earnView === 'charts' ? 'active' : ''}`}
                  onClick={() => setEarnView('charts')}
                >
                  <BarChart3 size={11} />
                  <span>CHARTS</span>
                </button>
              </div>
            </>
          )}

          {/* Published Releases Catalog Ledger / Visual Charts */}
          <div className="mypage-section earn-catalog-section">
            <div className="mypage-section-body">
              {publishedSongsList.length === 0 ? (
                <div className="mypage-empty">
                  <span className="mypage-empty-title">NO PUBLISHED RELEASES YET</span>
                  <span className="mypage-empty-desc">
                    Publish a track to start earning from Streaming and Licenses.
                  </span>
                  {draftsCount > 0 && (
                    <Button variant="secondary" size="xs" onClick={() => setActiveTab('workspace')}>
                      <Briefcase size={11} />
                      <span>GO TO WORKSPACE ({draftsCount} DRAFTS)</span>
                    </Button>
                  )}
                </div>
              ) : earnView === 'charts' ? (
                <Earn
                  songs={publishedSongsList}
                  songMetrics={earnAnalytics.allSongMetrics}
                  events={earnAnalytics.events}
                  globalNetworkFilter={earnNetworkFilter}
                  onNetworkFilterChange={setEarnNetworkFilter}
                  earnView={earnView}
                  onEarnViewChange={setEarnView}
                  dateWindow={earnDateWindow}
                  onDateWindowChange={setEarnDateWindow}
                  sourceFilter={earnSourceFilter}
                  onSourceFilterChange={setEarnSourceFilter}
                  hideControlRail
                  onRefresh={() => void refetchEarnings()}
                  isRefreshing={loadingEarnings}
                  onSelectSong={(song) => {
                    const isPlayingThis = state.isPlaying && state.activeSong?.id === song.id;
                    if (isPlayingThis) {
                      store.setPlaying(false);
                    } else {
                      store.playSong(song, state.songs, null);
                    }
                  }}
                />
              ) : filteredEarnSongs.length === 0 ? (
                <div className="mypage-empty">
                  <span className="mypage-empty-title">NO MATCHING RELEASES</span>
                  <span className="mypage-empty-desc">
                    Try clearing your search or switching the network filter.
                  </span>
                </div>
              ) : (
                <div className="earn-list-table" role="table" aria-label="Published releases ledger">
                  <div className="earn-list-header" role="row">
                    <div className="earn-list-th earn-cell-track" role="columnheader">
                      RELEASE
                    </div>
                    <div className="earn-list-th earn-cell-network" role="columnheader">
                      NETWORK
                    </div>
                    <div className="earn-list-th earn-cell-profit" role="columnheader">
                      PROFIT
                    </div>
                    <div className="earn-list-th earn-cell-licenses" role="columnheader">
                      LICENSES
                    </div>
                    <div className="earn-list-th earn-cell-metrics" role="columnheader">
                      PLAYS
                    </div>
                    <div className="earn-list-th earn-cell-actions" role="columnheader">
                      ACTIONS
                    </div>
                  </div>
                  <div className="earn-list-body" role="rowgroup">
                    {filteredEarnSongs.map((song) => renderAssetItem(song))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Album Studio Modal */}
      <AlbumModal
        isOpen={albumStudioOpen}
        onClose={() => {
          setAlbumStudioOpen(false);
          setEditingAlbum(null);
        }}
        album={editingAlbum}
        activeAddress={activeAddress}
        songs={state.songs}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ['albums'] });
        }}
      />

      {/* Edit Profile Modal */}
      {activeAddress && (
        <ProfileModal
          isOpen={profileModalOpen}
          onClose={() => setProfileModalOpen(false)}
          address={activeAddress}
        />
      )}

      {/* Edit Song Details Modal */}
      <EditSongModal
        isOpen={Boolean(editingDetailsSong)}
        onClose={() => setEditingDetailsSong(null)}
        song={editingDetailsSong}
        activeAddress={activeAddress}
        albums={albums}
        onAlbumsChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ['albums'] });
        }}
      />

      {/* 1-Click Album Assignment Modal */}
      {albumTargetSong && (
        <div className="market-modal-backdrop" onClick={() => setAlbumTargetSong(null)}>
          <div className="market-playlist-modal" onClick={(e) => e.stopPropagation()}>
            <div className="market-playlist-modal-header">
              <div className="market-playlist-modal-title-wrap">
                <Disc3 size={14} />
                <span>ALBUM</span>
              </div>
              <Button size="xs" variant="ghost" onClick={() => setAlbumTargetSong(null)} aria-label="Close">
                <X size={13} />
              </Button>
            </div>

            <div className="market-playlist-modal-target">{albumTargetSong.title}</div>

            <div className="market-playlist-modal-list">
              {albums.length === 0 ? (
                <div className="market-playlist-modal-empty">Create an album below</div>
              ) : (
                albums.map((album) => {
                  const alreadyIn = albumTargetSong.album_id === album.id;
                  const albumTrackCount = state.songs.filter((s) => s.album_id === album.id).length;
                  return (
                    <button
                      key={album.id}
                      type="button"
                      className={`market-playlist-modal-option ${alreadyIn ? 'in-playlist' : ''}`}
                      disabled={assigningAlbumId === album.id}
                      onClick={() => void handleToggleSongInAlbum(album, albumTargetSong)}
                    >
                      <div className="market-playlist-modal-option-left">
                        {album.public ? <Globe size={12} /> : <Lock size={12} />}
                        <span className="market-playlist-modal-option-title">{album.title}</span>
                      </div>
                      <span className="market-playlist-modal-option-meta">
                        {alreadyIn ? <Check size={12} /> : `${albumTrackCount}`}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <form
              className="market-playlist-modal-create"
              onSubmit={(e) => void handleCreateAlbum(e, albumTargetSong)}
            >
              <input
                type="text"
                className="market-playlist-modal-input"
                placeholder="New album..."
                value={newAlbumTitle}
                onChange={(e) => setNewAlbumTitle(e.target.value)}
                maxLength={80}
              />
              <Button
                type="submit"
                size="xs"
                variant="primary"
                disabled={creatingAlbum || !newAlbumTitle.trim()}
                aria-label="Create album and add track"
              >
                <Plus size={12} />
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* Publish Confirmation Modal */}
      <PublishModal
        isOpen={Boolean(publishConfirmSong)}
        onClose={() => setPublishConfirmSong(null)}
        song={publishConfirmSong}
        activeAddress={activeAddress}
        formattedAddress={formattedAddress}
        albums={albums}
        onConfirm={async (song: Song) => {
          const updated = await togglePublic(song);
          if (updated && updated.public) {
            const album = updated.album_id ? albumsMap.get(updated.album_id) : null;
            const payload = songToShareData(
              updated,
              nickname?.trim() || activeAddress || updated.creator,
              true,
              album?.cover || null
            );
            saveMintSuccessForShare(payload);
            setShareData(payload);
            setShowShareDialog(true);
          }
        }}
        pending={Boolean(publicPending)}
      />

      {/* Post-Publish & Track Share Modal */}
      <ShareModal
        isOpen={showShareDialog}
        onClose={() => handleCloseShareDialog(false)}
        data={shareData}
      />
    </div>
  );
};
