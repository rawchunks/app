import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Captions,
  ChevronLeft,
  ChevronRight,
  Clock,
  Disc3,
  Film,
  Headphones,
  ListMusic,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Send,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  User,
  UserCheck,
  UserPlus,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { GenreBadges } from '../components/dashboard/genres';
import { Queue } from '../components/queue';
import { ShareModal } from '../components/share';
import { Slider } from '../components/slider';
import { Tooltip } from '../components/daw/Tooltip';
import { Waveform } from '../components/waveform';
import { formatDuration, normalizeTags } from '../components/songs/card';
import { Licenses } from '../components/songs/licenses';
import { LikeButton, PlaylistAdder } from '../components/songs/row';
import { Versions } from '../components/songs/versions';
import { useSelectedUserAddress } from '../hooks/use-address';
import { usePublicAlbums } from '../hooks/use-albums';
import { useProfile } from '../hooks/use-profile';
import { useCreatorSocial, useSongComments } from '../hooks/use-social';
import { useSongs } from '../hooks/use-songs';
import { api } from '../lib/api';
import { audio } from '../lib/audio';
import { readCachedProfile } from '../lib/cache';
import { fetchPublicLyrics, type AlignedLine, type AlignedWord, type PublicLyrics } from '../lib/lyrics';
import {
  extractSongMetaFromResponse,
  getCachedLyrics,
  getCachedSongMeta,
  getCachedSongRecord,
  prefetchSongAssets,
  setCachedLyrics,
  setCachedSongMeta,
  setCachedSongRecord,
  type SongMeta,
} from '../lib/prefetch';
import { navigateToCreator, normalizeSlugKey } from '../lib/routes';
import { songToShareData, type MintShareData } from '../lib/share';
import { store, type RepeatMode, type State } from '../lib/store';
import { groupSongs } from '../lib/versions';
import type { Comment, Song } from '../lib/schema';

export interface Props {
  creatorSlug: string;
  songSlug: string;
  songId?: string;
  onBack: () => void;
}

type CompanionTab = 'lyrics' | 'queue' | 'notes';
type MobileStagePane = 'stage' | 'lyrics' | 'queue' | 'notes';

const NOTES_PAGE_SIZE = 4;

const formatShortAddr = (addr?: string | null): string => {
  if (!addr) return 'ANON';
  return addr.startsWith('0x')
    ? `${addr.slice(0, 6)}…${addr.slice(-4)}`
    : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

const formatClock = (secs: number): string => {
  const safe = Math.max(0, Math.floor(secs || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
};

function matchesCreatorSlug(song: Song, creatorSlug: string): boolean {
  const targetKey = normalizeSlugKey(creatorSlug);
  if (!targetKey) return false;
  if (normalizeSlugKey(song.creator) === targetKey) return true;
  const cached = readCachedProfile(song.creator);
  if (cached?.nickname && normalizeSlugKey(cached.nickname) === targetKey) return true;
  return false;
}

export const SongPage: React.FC<Props> = ({ creatorSlug, songSlug, songId, onBack }) => {
  const { readAddress, evmAddress, svmAddress } = useSelectedUserAddress();
  const { data: publicSongs = [] } = useSongs();
  const { data: publicAlbums = [] } = usePublicAlbums();

  const [storeState, setStoreState] = useState<State>(() => store.getState());
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [remoteSong, setRemoteSong] = useState<Song | null>(() => (songId ? getCachedSongRecord(songId) : null));
  const [songMeta, setSongMeta] = useState<SongMeta | null>(() => (songId ? getCachedSongMeta(songId) : null));
  const [lyricsData, setLyricsData] = useState<PublicLyrics | null>(() => (songId ? getCachedLyrics(songId) : null));
  const [coldLoading, setColdLoading] = useState(false);
  const [coldError, setColdError] = useState<string | null>(null);

  const [imgError, setImgError] = useState(false);
  const [localRatio, setLocalRatio] = useState(0);
  const [lockedTimestampSec, setLockedTimestampSec] = useState<number | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [activeComment, setActiveComment] = useState<Comment | null>(null);
  const [notesPage, setNotesPage] = useState(0);
  const [shareData, setShareData] = useState<MintShareData | null>(null);

  // Desktop companion tab: on cover songs, defaults to 'lyrics' (clean cover-left + 5-line lyrics-right!);
  // on video songs, defaults to null (unobstructed pure video) and toggles open cleanly without an intrusive wall.
  const [desktopPane, setDesktopPane] = useState<CompanionTab | null>('lyrics');
  const [videoPaneOpen, setVideoPaneOpen] = useState<CompanionTab | null>(null);
  const [showVideoCaptions, setShowVideoCaptions] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobileStagePane>('stage');
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    return store.subscribe((next) => {
      setStoreState((prev) => {
        if (
          prev.activeSong === next.activeSong &&
          prev.isPlaying === next.isPlaying &&
          prev.duration === next.duration &&
          prev.queue === next.queue &&
          prev.userQueue === next.userQueue &&
          prev.contextQueue === next.contextQueue &&
          prev.queueIndex === next.queueIndex &&
          prev.repeatMode === next.repeatMode &&
          prev.shuffle === next.shuffle &&
          prev.autoplay === next.autoplay &&
          prev.playbackContext === next.playbackContext &&
          prev.songs === next.songs
        ) {
          return prev;
        }
        return next;
      });
    });
  }, []);

  useEffect(() => {
    audio.setVolume(muted ? 0 : volume);
  }, [volume, muted]);

  // Instant synchronous resolution from canonical songId or existing client caches (<16ms zero-flash switch)
  const allKnownSongs = useMemo<Song[]>(() => {
    const map = new Map<string, Song>();
    if (storeState.activeSong?.id) map.set(storeState.activeSong.id, storeState.activeSong);
    for (const s of storeState.queue) {
      if (s?.id && !map.has(s.id)) map.set(s.id, s);
    }
    for (const s of publicSongs) {
      if (s?.id && !map.has(s.id)) map.set(s.id, s);
    }
    for (const s of storeState.songs) {
      if (s?.id && !map.has(s.id)) map.set(s.id, s);
    }
    if (songId) {
      const prefetched = getCachedSongRecord(songId);
      if (prefetched?.id && !map.has(prefetched.id)) map.set(prefetched.id, prefetched);
    }
    if (remoteSong?.id) {
      map.set(remoteSong.id, remoteSong);
    }
    return Array.from(map.values());
  }, [publicSongs, storeState.activeSong, storeState.queue, storeState.songs, songId, remoteSong]);

  const matchedBaseSong = useMemo<Song | null>(() => {
    if (songId) {
      const byId = allKnownSongs.find((s) => s.id === songId);
      if (byId) return byId;
    }
    const targetSongKey = normalizeSlugKey(songSlug);
    if (!targetSongKey) return remoteSong;

    const candidates = allKnownSongs.filter(
      (s) => s.id === songSlug || normalizeSlugKey(s.title) === targetSongKey,
    );
    if (candidates.length === 0) return remoteSong;

    const creatorMatch = candidates.find((s) => matchesCreatorSlug(s, creatorSlug));
    return creatorMatch ?? candidates[0];
  }, [allKnownSongs, creatorSlug, songSlug, songId, remoteSong]);

  const versions = useMemo<Song[]>(() => {
    if (!matchedBaseSong) return [];
    const grouped = groupSongs(allKnownSongs);
    const family = matchedBaseSong.family ?? matchedBaseSong.id;
    const found = grouped.find(
      (group) =>
        group.some((v) => v.id === matchedBaseSong.id) ||
        (group[0]?.family ?? group[0]?.id) === family,
    );
    return found && found.length > 0 ? found : [matchedBaseSong];
  }, [allKnownSongs, matchedBaseSong]);

  const song = useMemo<Song | null>(() => {
    if (selectedVersionId) {
      const picked = versions.find((v) => v.id === selectedVersionId);
      if (picked) return picked;
    }
    if (remoteSong && matchedBaseSong && remoteSong.id === matchedBaseSong.id) {
      return remoteSong;
    }
    return matchedBaseSong ?? remoteSong ?? null;
  }, [selectedVersionId, versions, remoteSong, matchedBaseSong]);

  // Hydrate immediately from prefetch cache on track switch (ZERO blank loading flash!)
  const resolvedSongId = song?.id ?? songId ?? null;
  useEffect(() => {
    setSelectedVersionId(null);
    setColdError(null);
    setLockedTimestampSec(null);
    setActiveComment(null);
    setNotesPage(0);
    if (resolvedSongId) {
      const cachedRec = getCachedSongRecord(resolvedSongId);
      const cachedMeta = getCachedSongMeta(resolvedSongId);
      const cachedLyr = getCachedLyrics(resolvedSongId);
      setRemoteSong(cachedRec);
      setSongMeta(cachedMeta);
      setLyricsData(cachedLyr);
    } else {
      setRemoteSong(null);
      setSongMeta(null);
      setLyricsData(null);
    }
  }, [resolvedSongId, creatorSlug, songSlug]);

  useEffect(() => {
    setImgError(false);
  }, [song?.id, song?.image]);

  // Warm the next track in queue immediately so skipping forward is instant
  useEffect(() => {
    const upcoming = store.peekNextSong();
    if (upcoming && upcoming.id !== song?.id) {
      prefetchSongAssets(upcoming, readAddress || undefined);
    }
  }, [song?.id, storeState.queue, readAddress]);

  const songLookupKey = resolvedSongId || songSlug;
  const viewerKey = readAddress?.trim().toLowerCase() || '';

  // Independent process 1: Song record & metadata hydration (stale-while-revalidate)
  useEffect(() => {
    if (!songLookupKey) return;
    let active = true;
    if (!song) setColdLoading(true);
    setColdError(null);

    const qs = creatorSlug?.trim() ? `?creator=${encodeURIComponent(creatorSlug.trim())}` : '';
    api
      .fetch(`/api/songs/${encodeURIComponent(songLookupKey)}${qs}`, {
        ...(viewerKey ? { userAddress: viewerKey } : {}),
      })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!active) return;
        if (!res.ok || !data?.song) {
          throw new Error(data?.error || 'Track not found');
        }
        const fetchedSong = data.song as Song;
        setCachedSongRecord(fetchedSong);
        setRemoteSong(fetchedSong);
        const meta = extractSongMetaFromResponse(data);
        setCachedSongMeta(fetchedSong.id, meta);
        setSongMeta(meta);
        setColdError(null);
      })
      .catch((err: any) => {
        if (!active) return;
        if (!song) {
          setColdError(err?.message || 'Track not found');
        }
      })
      .finally(() => {
        if (active) setColdLoading(false);
      });

    return () => {
      active = false;
    };
  }, [songLookupKey, creatorSlug, viewerKey]);

  // Independent process 2: Synced word-level lyrics hydration
  useEffect(() => {
    if (!songLookupKey) return;
    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const loadLyrics = () => {
      fetchPublicLyrics(songLookupKey, { creatorSlug, userAddress: viewerKey || undefined })
        .then((data) => {
          if (!active) return;
          setLyricsData(data);
          if (data.status === 'cached' || data.status === 'none') {
            setCachedLyrics(songLookupKey, data);
          }
          if (data.status === 'transcribing' && attempts < 12) {
            attempts += 1;
            pollTimer = setTimeout(loadLyrics, 2500);
          }
        })
        .catch(() => { });
    };

    const cached = getCachedLyrics(songLookupKey);
    if (cached && cached.status === 'cached') {
      setLyricsData(cached);
    } else {
      loadLyrics();
    }
    return () => {
      active = false;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [songLookupKey, creatorSlug, viewerKey]);

  const albumCover = useMemo(() => {
    if (!song?.album_id) return null;
    return publicAlbums.find((a) => a.id === song.album_id)?.cover || null;
  }, [publicAlbums, song?.album_id]);

  const creatorProfile = useProfile(song?.creator || creatorSlug);
  const { stats: creatorSocial, toggleFollow } = useCreatorSocial(song?.creator ?? null, readAddress);
  const isFollowing = Boolean(creatorSocial?.isFollowed);

  const isSelfCreator = useMemo(() => {
    const owner = (song?.creator || '').trim().toLowerCase();
    if (!owner) return false;
    return [readAddress, evmAddress, svmAddress]
      .filter((a): a is string => Boolean(a))
      .some((a) => a.trim().toLowerCase() === owner);
  }, [song?.creator, readAddress, evmAddress, svmAddress]);

  const { comments, addComment, isPosting, deleteComment } = useSongComments(
    song?.id ?? null,
    readAddress,
  );

  const isActiveTrack = Boolean(song?.id && storeState.activeSong?.id === song.id);
  const isPlayingThis = isActiveTrack && storeState.isPlaying;

  const effectiveDuration = useMemo(() => {
    if (isActiveTrack && storeState.duration > 0) return storeState.duration;
    if (song?.duration && song.duration > 0) return song.duration;
    return 120;
  }, [isActiveTrack, storeState.duration, song?.duration]);

  // Sync playhead cleanly from global store
  useEffect(() => {
    if (!song?.id) {
      setLocalRatio(0);
      return;
    }
    const sync = () => {
      const s = store.getState();
      if (s.activeSong?.id === song.id) {
        const dur = s.duration > 0 ? s.duration : song.duration || 60;
        const livePos = audio.position();
        const pos = livePos !== null ? livePos : s.playhead;
        setLocalRatio(dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0);
      } else {
        setLocalRatio(0);
      }
    };
    sync();
    return store.subscribe(sync);
  }, [song?.id, song?.duration]);

  const currentSec = useMemo(
    () => Math.max(0, Math.min(effectiveDuration, localRatio * effectiveDuration)),
    [localRatio, effectiveDuration],
  );

  const syncVideoTo = useCallback((sec: number) => {
    const vid = videoRef.current;
    if (!vid || vid.readyState < 1) return;
    vid.muted = true;
    vid.volume = 0;
    const target = Number.isFinite(vid.duration) && vid.duration > 0 ? sec % vid.duration : sec;
    if (Math.abs(vid.currentTime - target) > 0.35) {
      try {
        vid.currentTime = target;
      } catch { }
    }
  }, []);

  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (v) {
        try {
          v.pause();
          v.removeAttribute('src');
          v.load();
        } catch { }
      }
    };
  }, []);

  // 10 Hz karaoke playhead & muted background video sync
  useEffect(() => {
    const vid = videoRef.current;
    if (!isPlayingThis) {
      if (vid && !vid.paused) {
        try {
          vid.pause();
        } catch { }
      }
      return;
    }

    const tick = () => {
      const pos = audio.position();
      if (pos !== null && effectiveDuration > 0) {
        setLocalRatio(Math.max(0, Math.min(1, pos / effectiveDuration)));
        const v = videoRef.current;
        if (v && v.readyState >= 1) {
          v.muted = true;
          v.volume = 0;
          const target = Number.isFinite(v.duration) && v.duration > 0 ? pos % v.duration : pos;
          if (Math.abs(v.currentTime - target) > 0.4) {
            try {
              v.currentTime = target;
            } catch { }
          }
          if (v.paused) {
            void v.play().catch(() => { });
          }
        }
      }
    };

    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [isPlayingThis, effectiveDuration, song?.video]);

  // Isolated track context: versions + same creator's public releases ONLY (never dumps unrelated Market tracks)
  const creatorHandle =
    creatorProfile.nickname?.trim() ||
    (creatorSlug && !creatorSlug.startsWith('0x') ? creatorSlug : song?.creator || creatorSlug);
  const creatorLabel =
    creatorProfile.nickname?.trim() ||
    (creatorSlug && !creatorSlug.startsWith('0x') && creatorSlug.length < 28
      ? creatorSlug
      : formatShortAddr(song?.creator || creatorSlug));

  const defaultContextSongs = useMemo<Song[]>(() => {
    if (!song) return [];
    const seen = new Set<string>();
    const list: Song[] = [];
    for (const v of versions.length > 1 ? versions : [song]) {
      if (v?.id && !seen.has(v.id)) {
        seen.add(v.id);
        list.push(v);
      }
    }
    const creatorKey = (song.creator || '').trim().toLowerCase();
    if (creatorKey && song.public) {
      for (const p of publicSongs) {
        if (
          p?.id &&
          p.public &&
          (p.creator || '').trim().toLowerCase() === creatorKey &&
          !seen.has(p.id)
        ) {
          seen.add(p.id);
          list.push(p);
        }
      }
    }
    return list;
  }, [song, versions, publicSongs]);

  // Seed global player ONLY if no track is loaded at all on cold deep-link
  useEffect(() => {
    if (!song) return;
    const s = store.getState();
    if (!s.activeSong) {
      store.setActiveSong(song, defaultContextSongs, null, `song:${song.id}`, false, {
        domain: 'song',
        id: `song:${song.id}`,
        label: creatorLabel,
        isPrivate: !song.public,
      });
    }
  }, [song, defaultContextSongs, creatorLabel]);

  const handlePlayToggle = useCallback(() => {
    if (!song) return;
    const s = store.getState();
    if (s.activeSong?.id === song.id && s.isPlaying) {
      void store.setPlaying(false);
      return;
    }
    if (s.activeSong?.id === song.id && audio.hasSource()) {
      void store.setPlaying(true);
      return;
    }
    const alreadyInQueue = s.queue.some((q) => q.id === song.id) && (s.userQueue.length > 0 || s.contextQueue.length > 0);
    if (alreadyInQueue) {
      void store.playSong(song);
      return;
    }
    void store.playSong(song, defaultContextSongs, null, `song:${song.id}`, false, {
      domain: 'song',
      id: `song:${song.id}`,
      label: creatorLabel,
      isPrivate: !song.public,
    });
  }, [song, defaultContextSongs, creatorLabel]);

  const handleWaveformSeek = useCallback(
    (ratio: number) => {
      if (!song) return;
      const clamped = Math.max(0, Math.min(1, ratio));
      const targetSec = Number((clamped * effectiveDuration).toFixed(1));
      setLocalRatio(clamped);
      setLockedTimestampSec(targetSec);
      syncVideoTo(targetSec);

      const s = store.getState();
      if (s.activeSong?.id !== song.id) {
        const alreadyInQueue = s.queue.some((q) => q.id === song.id) && (s.userQueue.length > 0 || s.contextQueue.length > 0);
        const queueList = alreadyInQueue ? undefined : defaultContextSongs;
        void store
          .playSong(
            song,
            queueList,
            null,
            alreadyInQueue ? undefined : `song:${song.id}`,
            false,
            alreadyInQueue
              ? undefined
              : {
                  domain: 'song',
                  id: `song:${song.id}`,
                  label: creatorLabel,
                  isPrivate: !song.public,
                },
          )
          .then((ok) => {
            if (ok) store.setPlayhead(targetSec);
          });
      } else {
        store.setPlayhead(targetSec);
        if (!s.isPlaying) {
          void store.setPlaying(true);
        }
      }
    },
    [song, defaultContextSongs, creatorLabel, effectiveDuration, syncVideoTo],
  );

  const handleJumpToTimestamp = useCallback(
    (sec: number) => {
      const ratio = effectiveDuration > 0 ? Math.max(0, Math.min(1, sec / effectiveDuration)) : 0;
      handleWaveformSeek(ratio);
    },
    [effectiveDuration, handleWaveformSeek],
  );

  const cycleRepeatMode = () => {
    const next: RepeatMode =
      storeState.repeatMode === 'off' ? 'all' : storeState.repeatMode === 'all' ? 'one' : 'off';
    store.setRepeatMode(next);
  };

  // Horizontal touch swipe on stage to skip tracks cleanly
  const handleStageTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleStageTouchEnd = (e: React.TouchEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || e.changedTouches.length === 0) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 58 && Math.abs(dx) > Math.abs(dy) * 1.45) {
      if (dx < 0) void store.playNextTrack();
      else void store.playPreviousTrack();
    }
  };

  // Word-synced sung lyrics lines (isTag: false only)
  const cleanLyricLines = useMemo<AlignedLine[]>(() => {
    const raw = lyricsData?.alignment?.lines;
    if (!raw || raw.length === 0) return [];
    const result: AlignedLine[] = [];
    for (const line of raw) {
      if (!line || line.isTag) continue;
      const words: AlignedWord[] = (line.words || []).filter((w) => w && typeof w.text === 'string' && w.text.trim());
      const text = words.length > 0 ? words.map((w) => w.text.trim()).join(' ') : (line.text || '').trim();
      if (!text) continue;
      result.push({
        index: result.length,
        text,
        isTag: false,
        start: words.length > 0 ? words[0].start : line.start,
        end: words.length > 0 ? words[words.length - 1].end : line.end,
        words,
      });
    }
    return result;
  }, [lyricsData?.alignment]);

  const activeLineIndex = useMemo(() => {
    if (cleanLyricLines.length === 0) return -1;
    for (let i = 0; i < cleanLyricLines.length; i++) {
      const line = cleanLyricLines[i];
      if (
        line.start !== null &&
        line.end !== null &&
        currentSec >= line.start - 0.12 &&
        currentSec <= line.end + 0.35
      ) {
        return i;
      }
    }
    let latest = 0;
    for (let i = 0; i < cleanLyricLines.length; i++) {
      const s = cleanLyricLines[i].start;
      if (s !== null && s <= currentSec + 0.15) {
        latest = i;
      }
    }
    return latest;
  }, [cleanLyricLines, currentSec]);

  const renderKaraokeLine = (line: AlignedLine, role: 'past' | 'active' | 'upcoming') => {
    const seekSec = line.start ?? 0;
    const dist = Math.abs(line.index - Math.max(0, activeLineIndex));
    return (
      <div
        key={`${line.index}-${line.start ?? 'x'}`}
        className={`song-karaoke-line is-${role}`}
        data-dist={dist}
        role="button"
        tabIndex={0}
        onClick={() => handleJumpToTimestamp(seekSec)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleJumpToTimestamp(seekSec);
          }
        }}
      >
        {line.words.length > 0 ? (
          line.words.map((w, wi) => {
            const isActiveWord =
              role === 'active' && isPlayingThis && currentSec >= w.start - 0.05 && currentSec <= w.end + 0.14;
            const isSungWord = role === 'active' && isPlayingThis && currentSec > w.end + 0.14;
            return (
              <span
                key={wi}
                className={`song-karaoke-word ${isActiveWord ? 'is-word-active' : isSungWord ? 'is-word-sung' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleJumpToTimestamp(w.start);
                }}
              >
                {w.text}
                {wi < line.words.length - 1 ? ' ' : ''}
              </span>
            );
          })
        ) : (
          <span>{line.text}</span>
        )}
      </div>
    );
  };

  const liveTimedComment = useMemo(() => {
    if (activeComment) return activeComment;
    if (!isPlayingThis || comments.length === 0) return null;
    let best: Comment | null = null;
    let bestDist = 1.8;
    for (const c of comments) {
      const dist = Math.abs(c.timestamp_sec - currentSec);
      if (dist <= bestDist) {
        best = c;
        bestDist = dist;
      }
    }
    return best;
  }, [activeComment, isPlayingThis, comments, currentSec]);

  const targetCommentSec =
    lockedTimestampSec !== null ? lockedTimestampSec : Number(currentSec.toFixed(1));

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commentBody.trim();
    if (!trimmed) return;
    try {
      const created = await addComment({
        timestampSec: targetCommentSec,
        body: trimmed,
      });
      setCommentBody('');
      setLockedTimestampSec(null);
      setActiveComment(created);
    } catch { }
  };

  const openShareModal = useCallback(
    (targetSong?: Song) => {
      const s = targetSong ?? song;
      if (!s) return;
      setShareData(songToShareData(s, creatorHandle, false, albumCover));
    },
    [song, creatorHandle, albumCover],
  );

  // Cold deep-link empty state
  if (!song) {
    return (
      <div className="song-page song-page-empty">
        <div className="song-empty-card">
          <p className="song-empty-title">
            {coldLoading ? 'LOADING TRACK…' : (coldError || 'TRACK NOT FOUND').toUpperCase()}
          </p>
          {!coldLoading && (
            <button type="button" className="creator-back-btn" onClick={onBack}>
              <ArrowLeft size={13} />
              <span>BACK</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const coverSrc =
    !imgError && song.image && song.image.trim() !== ''
      ? song.image
      : !imgError && albumCover && albumCover.trim() !== ''
        ? albumCover
        : null;
  const hasSavedVideo = Boolean(song.video && song.video.trim());
  const hasLyrics = cleanLyricLines.length > 0;
  const isTranscribingLyrics = lyricsData?.status === 'transcribing' && !hasLyrics;
  const tags = normalizeTags(song.tags).slice(0, 3);
  const totalComments = Math.max(comments.length, song.comments_count ?? 0);
  const upcomingCount = storeState.userQueue.length + storeState.contextQueue.length;

  // Always preserve crisp 5-line karaoke focal window!
  const focusRadius = 2;
  const centerIdx = Math.max(0, activeLineIndex);
  const sliceStart = Math.max(0, Math.min(centerIdx - focusRadius, Math.max(0, cleanLyricLines.length - 5)));
  const sliceEnd = Math.min(cleanLyricLines.length, sliceStart + 5);
  const fiveLineLyrics = cleanLyricLines.slice(sliceStart, sliceEnd);

  // Borderless 2-line subtle subtitle ONLY when user toggles captions in full-bleed cinema video mode
  const cinemaCaptionLines = cleanLyricLines.slice(
    Math.max(0, centerIdx),
    Math.min(cleanLyricLines.length, Math.max(0, centerIdx) + 2),
  );

  const notesTotalPages = Math.max(1, Math.ceil(comments.length / NOTES_PAGE_SIZE));
  const safeNotesPage = Math.min(notesPage, notesTotalPages - 1);
  const visibleComments = comments.slice(safeNotesPage * NOTES_PAGE_SIZE, (safeNotesPage + 1) * NOTES_PAGE_SIZE);

  // Active right companion tab on Desktop
  const activeCoverRightTab: CompanionTab | null =
    desktopPane === 'lyrics' && !hasLyrics && !isTranscribingLyrics ? null : desktopPane;
  const activeRightTab: CompanionTab | null = hasSavedVideo ? videoPaneOpen : activeCoverRightTab;

  const toggleDesktopTab = (tab: CompanionTab) => {
    if (hasSavedVideo) {
      setVideoPaneOpen((prev) => (prev === tab ? null : tab));
    } else {
      setDesktopPane((prev) => (prev === tab ? (hasLyrics || isTranscribingLyrics ? 'lyrics' : null) : tab));
    }
  };

  const renderLyricsBody = () => {
    if (hasLyrics) {
      return (
        <div className="song-lyrics-stage" aria-label="Synced lyrics" aria-live="polite">
          <div className="song-lyrics-window">
            {fiveLineLyrics.map((line) => {
              const role =
                line.index < activeLineIndex
                  ? 'past'
                  : line.index === activeLineIndex
                    ? 'active'
                    : 'upcoming';
              return renderKaraokeLine(line, role);
            })}
          </div>
        </div>
      );
    }
    if (isTranscribingLyrics) {
      return (
        <div className="song-lyrics-stage is-syncing" aria-live="polite">
          <div className="song-lyrics-syncing-pill">
            <Loader2 size={13} className="song-spin" />
            <span>SYNCING LYRICS…</span>
          </div>
        </div>
      );
    }
    return (
      <div className="song-companion-empty">
        <span>Instrumental track</span>
      </div>
    );
  };

  const renderNotesBody = () => (
    <div className="song-notes-pane">
      <form className="song-notes-composer" onSubmit={handleSubmitComment}>
        <Tooltip title="Lock or unlock comment timestamp">
          <button
            type="button"
            className={`timeline-timestamp-lock ${lockedTimestampSec !== null ? 'locked' : ''}`}
            onClick={() =>
              setLockedTimestampSec((prev) =>
                prev !== null ? null : Number(currentSec.toFixed(1)),
              )
            }
          >
            <Clock size={11} />
            <span>@{formatDuration(targetCommentSec)}</span>
          </button>
        </Tooltip>

        <input
          type="text"
          className="timeline-composer-input"
          placeholder={`Note at @${formatDuration(targetCommentSec)}…`}
          value={commentBody}
          onFocus={() => {
            if (lockedTimestampSec === null) {
              setLockedTimestampSec(Number(currentSec.toFixed(1)));
            }
          }}
          onChange={(e) => setCommentBody(e.target.value)}
          maxLength={280}
        />

        <Tooltip title="Post note">
          <button
            type="submit"
            className="timeline-composer-send"
            disabled={isPosting || !commentBody.trim()}
            aria-label="Post timed comment"
          >
            <Send size={12} />
          </button>
        </Tooltip>
      </form>

      <div className="song-notes-list">
        {comments.length === 0 ? (
          <div className="song-companion-empty">
            <span>Drop a timestamped note along the waveform.</span>
          </div>
        ) : (
          visibleComments.map((c) => {
            const authorLabel = c.author_nickname?.trim() || formatShortAddr(c.author);
            const isOwner = Boolean(
              readAddress && c.author.toLowerCase() === readAddress.toLowerCase(),
            );
            return (
              <div key={c.id} className="song-note-row">
                <button
                  type="button"
                  className="timeline-comment-time-badge"
                  onClick={() => handleJumpToTimestamp(c.timestamp_sec)}
                >
                  @{formatDuration(c.timestamp_sec)}
                </button>
                <div className="song-note-copy">
                  <button
                    type="button"
                    className="timeline-comment-author"
                    onClick={() => navigateToCreator(c.author)}
                  >
                    {authorLabel}
                  </button>
                  <span className="song-note-text">{c.body}</span>
                </div>
                {isOwner && (
                  <Tooltip title="Delete note">
                    <button
                      type="button"
                      className="timeline-comment-del-btn"
                      onClick={() => void deleteComment(c.id)}
                      aria-label="Delete comment"
                    >
                      <Trash2 size={11} />
                    </button>
                  </Tooltip>
                )}
              </div>
            );
          })
        )}
      </div>

      {notesTotalPages > 1 && (
        <div className="queue-pager">
          <button
            type="button"
            className="queue-icon-btn"
            disabled={safeNotesPage <= 0}
            onClick={() => setNotesPage((p) => Math.max(0, p - 1))}
            aria-label="Previous notes page"
          >
            <ChevronLeft size={13} />
          </button>
          <span className="queue-pager-info">
            {safeNotesPage + 1} / {notesTotalPages}
          </span>
          <button
            type="button"
            className="queue-icon-btn"
            disabled={safeNotesPage >= notesTotalPages - 1}
            onClick={() => setNotesPage((p) => Math.min(notesTotalPages - 1, p + 1))}
            aria-label="Next notes page"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );

  const renderCompanionContent = (tab: CompanionTab) => {
    if (tab === 'lyrics') return renderLyricsBody();
    if (tab === 'queue') return <Queue state={storeState} variant="panel" pageSize={5} />;
    return renderNotesBody();
  };

  return (
    <div
      className={`song-page ${hasSavedVideo ? 'has-video' : ''} ${activeRightTab ? 'has-companion' : ''} ${isPlayingThis ? 'is-playing' : ''}`}
      data-mobile-pane={mobilePane}
    >
      {/* Full-bleed muted video OR ambient cover refraction backdrop */}
      {hasSavedVideo ? (
        <div className="song-bg-layer" aria-hidden="true">
          <video
            key={song.video}
            ref={videoRef}
            src={song.video!}
            muted
            playsInline
            preload="auto"
            className="song-bg-video"
            onLoadedMetadata={() => {
              if (videoRef.current) {
                videoRef.current.muted = true;
                videoRef.current.volume = 0;
              }
            }}
          />
          <div className="song-bg-scrim" />
        </div>
      ) : coverSrc ? (
        <div className="song-bg-layer" aria-hidden="true">
          <img src={coverSrc} alt="" className="song-bg-ambient" />
          <div className="song-bg-scrim song-bg-scrim-cover" />
        </div>
      ) : null}

      <div className="song-foreground">
        {/* Top Micro-Bar (Single Creator Pill — ZERO Duplicate Creator Badges!) */}
        <header className="song-topbar">
          <div className="song-topbar-left">
            <Tooltip title="Back">
              <button
                type="button"
                className="song-icon-pill"
                onClick={onBack}
                aria-label="Back"
              >
                <ArrowLeft size={14} />
              </button>
            </Tooltip>

            <Tooltip title={`Open ${creatorLabel}`}>
              <button
                type="button"
                className="song-creator-pill"
                onClick={() => navigateToCreator(creatorHandle)}
                aria-label={`Open ${creatorLabel}`}
              >
                {creatorProfile.avatar ? (
                  <img src={creatorProfile.avatar} alt="" className="song-creator-avatar" />
                ) : (
                  <User size={12} />
                )}
                <span>{creatorLabel}</span>
              </button>
            </Tooltip>

            {!isSelfCreator && song.creator && (
              <Tooltip title={isFollowing ? `Following ${creatorLabel}` : `Follow ${creatorLabel}`}>
                <button
                  type="button"
                  className={`song-icon-pill ${isFollowing ? 'is-following' : ''}`}
                  onClick={(e) => toggleFollow(e)}
                  aria-label={isFollowing ? `Unfollow ${creatorLabel}` : `Follow ${creatorLabel}`}
                >
                  {isFollowing ? <UserCheck size={13} /> : <UserPlus size={13} />}
                </button>
              </Tooltip>
            )}
          </div>

          <div className="song-topbar-right">
            {/* Desktop Companion Switcher (non-intrusive open switcher, 1-click Cinema on video) */}
            <div className="song-desktop-switch" role="tablist" aria-label="Companion view">
              {(hasLyrics || isTranscribingLyrics) && (
                <Tooltip title="5-line synced lyrics">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeRightTab === 'lyrics'}
                    className={`song-mode-pill ${activeRightTab === 'lyrics' ? 'active' : ''}`}
                    onClick={() => toggleDesktopTab('lyrics')}
                  >
                    <Captions size={13} />
                    <span>LYRICS</span>
                  </button>
                </Tooltip>
              )}

              <Tooltip title={`Up Next (${upcomingCount})`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeRightTab === 'queue'}
                  className={`song-mode-pill ${activeRightTab === 'queue' ? 'active' : ''}`}
                  onClick={() => toggleDesktopTab('queue')}
                >
                  <ListMusic size={13} />
                  <span>QUEUE</span>
                  {upcomingCount > 0 && <span className="song-pill-count">{upcomingCount}</span>}
                </button>
              </Tooltip>

              <Tooltip title={`Timed notes (${totalComments})`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeRightTab === 'notes'}
                  className={`song-mode-pill ${activeRightTab === 'notes' ? 'active' : ''}`}
                  onClick={() => toggleDesktopTab('notes')}
                >
                  <MessageSquare size={13} />
                  <span>NOTES</span>
                  {totalComments > 0 && <span className="song-pill-count">{totalComments}</span>}
                </button>
              </Tooltip>

              {hasSavedVideo && !videoPaneOpen && hasLyrics && (
                <Tooltip title={showVideoCaptions ? 'Hide video subtitles' : 'Show video subtitles'}>
                  <button
                    type="button"
                    className={`song-icon-pill ${showVideoCaptions ? 'active' : ''}`}
                    onClick={() => setShowVideoCaptions((v) => !v)}
                    aria-label="Toggle video subtitles"
                    aria-pressed={showVideoCaptions}
                  >
                    <Captions size={13} />
                  </button>
                </Tooltip>
              )}

              {hasSavedVideo && videoPaneOpen && (
                <Tooltip title="Cinema view">
                  <button
                    type="button"
                    className="song-icon-pill"
                    onClick={() => setVideoPaneOpen(null)}
                    aria-label="Expand cinema video"
                  >
                    <Maximize2 size={13} />
                  </button>
                </Tooltip>
              )}

              {!hasSavedVideo && activeRightTab && (
                <Tooltip title="Focus cover art">
                  <button
                    type="button"
                    className="song-icon-pill"
                    onClick={() => setDesktopPane(null)}
                    aria-label="Hide companion view"
                  >
                    <Minimize2 size={13} />
                  </button>
                </Tooltip>
              )}
            </div>

            {/* Mobile Single-Pane Switcher (Icon-Only + Tooltip, ZERO Vertical Stacking) */}
            <div className="song-mobile-switch" role="tablist" aria-label="Stage view">
              <Tooltip title={hasSavedVideo ? 'Video' : 'Cover Art'}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mobilePane === 'stage'}
                  className={`song-icon-pill ${mobilePane === 'stage' ? 'active' : ''}`}
                  onClick={() => setMobilePane('stage')}
                  aria-label={hasSavedVideo ? 'Video stage' : 'Cover art'}
                >
                  {hasSavedVideo ? <Film size={13} /> : <Disc3 size={13} />}
                </button>
              </Tooltip>

              {(hasLyrics || isTranscribingLyrics) && (
                <Tooltip title="Lyrics">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mobilePane === 'lyrics'}
                    className={`song-icon-pill ${mobilePane === 'lyrics' ? 'active' : ''}`}
                    onClick={() => setMobilePane('lyrics')}
                    aria-label="Synced lyrics"
                  >
                    <Captions size={13} />
                  </button>
                </Tooltip>
              )}

              <Tooltip title={`Queue (${upcomingCount})`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mobilePane === 'queue'}
                  className={`song-icon-pill ${mobilePane === 'queue' ? 'active' : ''}`}
                  onClick={() => setMobilePane('queue')}
                  aria-label="Up next queue"
                >
                  <ListMusic size={13} />
                </button>
              </Tooltip>

              <Tooltip title={`Notes (${totalComments})`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mobilePane === 'notes'}
                  className={`song-icon-pill ${mobilePane === 'notes' ? 'active' : ''}`}
                  onClick={() => setMobilePane('notes')}
                  aria-label="Timed notes"
                >
                  <MessageSquare size={13} />
                </button>
              </Tooltip>
            </div>

            <Tooltip title="Share track">
              <button
                type="button"
                className="song-icon-pill"
                onClick={() => openShareModal(song)}
                aria-label="Share track"
              >
                <Share2 size={13} />
              </button>
            </Tooltip>
          </div>
        </header>

        {/* Center Stage: Open Airy Cover-Left + 5-Line Lyrics-Right (or Unobstructed Video + Whisper-Thin Glass Companion) */}
        <section
          className="song-center-stage"
          aria-label="Track stage"
          onTouchStart={handleStageTouchStart}
          onTouchEnd={handleStageTouchEnd}
        >
          {/* Desktop Stage */}
          <div className={`song-desktop-stage ${hasSavedVideo ? 'is-video' : 'is-cover'} ${activeRightTab ? 'is-split' : ''}`}>
            {!hasSavedVideo ? (
              <>
                <button
                  type="button"
                  className={`song-hero-art ${isPlayingThis ? 'is-playing' : ''}`}
                  onClick={handlePlayToggle}
                  aria-label={isPlayingThis ? `Pause ${song.title}` : `Play ${song.title}`}
                >
                  {coverSrc ? (
                    <img
                      src={coverSrc}
                      alt={song.title}
                      className="song-hero-art-img"
                      onError={() => setImgError(true)}
                    />
                  ) : (
                    <div className="song-hero-art-fallback">
                      <img src="/branding/mark.svg" alt="" className="song-hero-art-mark" />
                    </div>
                  )}
                  <span className="song-hero-play-overlay" aria-hidden="true">
                    {isPlayingThis ? (
                      <Pause size={28} />
                    ) : (
                      <Play size={28} className="market-play-icon-offset" />
                    )}
                  </span>
                </button>

                {activeRightTab && (
                  <div className="song-companion-open">
                    {renderCompanionContent(activeRightTab)}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="song-video-viewport" onClick={handlePlayToggle}>
                  {!videoPaneOpen && showVideoCaptions && hasLyrics && cinemaCaptionLines.length > 0 && (
                    <div className="song-cinema-subtitles" aria-live="polite" onClick={(e) => e.stopPropagation()}>
                      {cinemaCaptionLines.map((line) => {
                        const role = line.index === activeLineIndex ? 'active' : 'upcoming';
                        return renderKaraokeLine(line, role);
                      })}
                    </div>
                  )}
                </div>

                {videoPaneOpen && (
                  <aside className="song-video-glass-companion">
                    {renderCompanionContent(videoPaneOpen)}
                  </aside>
                )}
              </>
            )}
          </div>

          {/* Mobile Single-Pane Stage (ZERO Vertical Stacking!) */}
          <div className="song-mobile-stage">
            {mobilePane === 'stage' && (
              hasSavedVideo ? (
                <div className="song-mobile-video-tap" onClick={handlePlayToggle}>
                  {hasLyrics && showVideoCaptions && cinemaCaptionLines.length > 0 && (
                    <div className="song-cinema-subtitles" aria-live="polite" onClick={(e) => e.stopPropagation()}>
                      {cinemaCaptionLines.map((line) => {
                        const role = line.index === activeLineIndex ? 'active' : 'upcoming';
                        return renderKaraokeLine(line, role);
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className={`song-hero-art ${isPlayingThis ? 'is-playing' : ''}`}
                  onClick={handlePlayToggle}
                  aria-label={isPlayingThis ? `Pause ${song.title}` : `Play ${song.title}`}
                >
                  {coverSrc ? (
                    <img
                      src={coverSrc}
                      alt={song.title}
                      className="song-hero-art-img"
                      onError={() => setImgError(true)}
                    />
                  ) : (
                    <div className="song-hero-art-fallback">
                      <img src="/branding/mark.svg" alt="" className="song-hero-art-mark" />
                    </div>
                  )}
                  <span className="song-hero-play-overlay" aria-hidden="true">
                    {isPlayingThis ? (
                      <Pause size={28} />
                    ) : (
                      <Play size={28} className="market-play-icon-offset" />
                    )}
                  </span>
                </button>
              )
            )}
            {mobilePane === 'lyrics' && (
              <div className="song-mobile-pane-body">{renderLyricsBody()}</div>
            )}
            {mobilePane === 'queue' && (
              <div className="song-mobile-pane-body">
                <Queue state={storeState} variant="panel" pageSize={5} />
              </div>
            )}
            {mobilePane === 'notes' && (
              <div className="song-mobile-pane-body">{renderNotesBody()}</div>
            )}
          </div>
        </section>

        {/* Unified Bottom Stage Console (Absorbs .app-player — 1 Title, 1 Waveform Scrubber, 1 Transport) */}
        <article
          className={`creator-timeline-card song-console ${isPlayingThis ? 'is-playing' : ''}`}
          data-guide-entity={song.id}
        >
          {/* Single Waveform Scrubber + Timed Comment Pins */}
          <div className={`timeline-waveform-stage ${comments.length === 0 && !liveTimedComment ? 'is-compact-wave' : ''}`}>
            <Waveform
              audioUrl={song.url}
              timelineDuration={effectiveDuration}
              interactive={false}
              showSelection={false}
              height={42}
              progress={localRatio}
              onSeek={handleWaveformSeek}
              className="timeline-base-waveform"
            />

            {comments.length > 0 && (
              <div className="timeline-pins-rail">
                {comments.map((c) => {
                  const pct =
                    effectiveDuration > 0
                      ? Math.max(1, Math.min(99, (c.timestamp_sec / effectiveDuration) * 100))
                      : 0;
                  const isHighlighted = liveTimedComment?.id === c.id;
                  const authorLabel = c.author_nickname?.trim() || formatShortAddr(c.author);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`timeline-comment-pin ${isHighlighted ? 'active' : ''}`}
                      style={{ left: `${pct}%` }}
                      onMouseEnter={() => setActiveComment(c)}
                      onMouseLeave={() => setActiveComment((prev) => (prev?.id === c.id ? null : prev))}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveComment(c);
                        handleJumpToTimestamp(c.timestamp_sec);
                      }}
                      aria-label={`Comment at ${formatDuration(c.timestamp_sec)} by ${authorLabel}`}
                    >
                      {c.author_avatar ? (
                        <img src={c.author_avatar} alt="" className="timeline-pin-avatar" />
                      ) : (
                        <span className="timeline-pin-dot" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {liveTimedComment && (
              <div className="timeline-live-comment-banner">
                <button
                  type="button"
                  className="timeline-comment-time-badge"
                  onClick={() => handleJumpToTimestamp(liveTimedComment.timestamp_sec)}
                >
                  @{formatDuration(liveTimedComment.timestamp_sec)}
                </button>
                <button
                  type="button"
                  className="timeline-comment-author"
                  onClick={() => navigateToCreator(liveTimedComment.author)}
                >
                  {liveTimedComment.author_nickname?.trim() || formatShortAddr(liveTimedComment.author)}
                </button>
                <span className="timeline-comment-body">{liveTimedComment.body}</span>
              </div>
            )}
          </div>

          {/* Unified Identity + Transport + Actions Strip */}
          <div className="song-console-bar">
            <div className="song-console-identity">
              <div className="song-console-title-row">
                <h1 className="song-console-title" title={song.title}>
                  {song.title}
                </h1>
                {versions.length > 1 && (
                  <Versions
                    songs={versions}
                    selected={song.id}
                    onSelect={(ver) => {
                      setSelectedVersionId(ver.id);
                      if (store.getState().activeSong?.id === song.id) {
                        store.setActiveSong(ver, versions, null, `song:${ver.id}`);
                      }
                    }}
                  />
                )}
              </div>

              <div className="song-console-meta">
                {typeof song.plays === 'number' && song.plays > 0 && (
                  <span className="timeline-stat-pill">
                    <Headphones size={10} />
                    <span>{song.plays}</span>
                  </span>
                )}
                {typeof song.plays === 'number' && song.plays > 0 && (songMeta?.bpm || songMeta?.keyScale) ? (
                  <span className="song-meta-dot" aria-hidden="true">·</span>
                ) : null}
                {songMeta?.bpm ? <span className="timeline-stat-pill">{songMeta.bpm} BPM</span> : null}
                {songMeta?.bpm && songMeta?.keyScale ? (
                  <span className="song-meta-dot" aria-hidden="true">·</span>
                ) : null}
                {songMeta?.keyScale ? <span className="timeline-stat-pill">{songMeta.keyScale}</span> : null}
                {tags.length > 0 && <GenreBadges genres={tags} isMobile />}
              </div>
            </div>

            <div className="song-console-transport">
              <Tooltip title={storeState.shuffle ? 'Shuffle: ON' : 'Shuffle: OFF'} position="top">
                <button
                  type="button"
                  className={`song-console-btn is-desktop-only ${storeState.shuffle ? 'active' : ''}`}
                  onClick={() => store.setShuffle(!storeState.shuffle)}
                  aria-label="Shuffle"
                >
                  <Shuffle size={13} />
                </button>
              </Tooltip>

              <Tooltip title="Previous" description="Shift + ←" position="top">
                <button
                  type="button"
                  className="song-console-btn"
                  onClick={() => void store.playPreviousTrack()}
                  aria-label="Previous track"
                >
                  <SkipBack size={14} />
                </button>
              </Tooltip>

              <Tooltip title={isPlayingThis ? 'Pause' : 'Play'} description="Space" position="top">
                <button
                  type="button"
                  className={`song-console-play ${isPlayingThis ? 'active' : ''}`}
                  onClick={handlePlayToggle}
                  aria-label={isPlayingThis ? 'Pause' : 'Play'}
                >
                  {isPlayingThis ? <Pause size={15} /> : <Play size={15} />}
                </button>
              </Tooltip>

              <Tooltip title="Next" description="Shift + →" position="top">
                <button
                  type="button"
                  className="song-console-btn"
                  onClick={() => void store.playNextTrack()}
                  aria-label="Next track"
                >
                  <SkipForward size={14} />
                </button>
              </Tooltip>

              <Tooltip
                title={
                  storeState.repeatMode === 'one'
                    ? 'Repeat One'
                    : storeState.repeatMode === 'all'
                      ? 'Repeat Context'
                      : 'Repeat Off'
                }
                position="top"
              >
                <button
                  type="button"
                  className={`song-console-btn is-desktop-only ${storeState.repeatMode !== 'off' ? 'active' : ''}`}
                  onClick={cycleRepeatMode}
                  aria-label="Repeat"
                >
                  {storeState.repeatMode === 'one' ? <Repeat1 size={13} /> : <Repeat size={13} />}
                </button>
              </Tooltip>

              <span className="song-console-time">
                {formatClock(currentSec)} / {formatClock(effectiveDuration)}
              </span>
            </div>

            <div className="song-console-actions">
              <LikeButton songId={song.id} likesCount={song.likes} showCount />
              <PlaylistAdder song={song} onShare={openShareModal} />
              <Licenses key={song.id} song={song} placement="market" compact />
              <div className="song-console-volume">
                <Tooltip title={muted ? 'Unmute (M)' : 'Mute (M)'} position="top">
                  <button
                    type="button"
                    className="song-console-btn"
                    onClick={() => setMuted((prev) => !prev)}
                    aria-label={muted ? 'Unmute' : 'Mute'}
                  >
                    {muted || volume === 0 ? <VolumeX size={13} /> : <Volume2 size={13} />}
                  </button>
                </Tooltip>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(v) => {
                    setMuted(false);
                    setVolume(v);
                  }}
                  label="VOL"
                />
              </div>
            </div>
          </div>
        </article>
      </div>

      <ShareModal
        isOpen={Boolean(shareData)}
        onClose={() => setShareData(null)}
        data={shareData}
      />
    </div>
  );
};
