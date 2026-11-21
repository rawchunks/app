import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Captions,
  Clock,
  Headphones,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Send,
  Share2,
  Trash2,
  User,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { Badge } from '../components/badge';
import { Modal } from '../components/modal';
import { ShareModal } from '../components/share';
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
import { navigateToCreator, normalizeSlugKey } from '../lib/routes';
import { songToShareData, type MintShareData } from '../lib/share';
import { store } from '../lib/store';
import { groupSongs } from '../lib/versions';
import type { Comment, Song } from '../lib/schema';

export interface Props {
  creatorSlug: string;
  songSlug: string;
  onBack: () => void;
}

const formatShortAddr = (addr?: string | null): string => {
  if (!addr) return 'ANON';
  return addr.startsWith('0x')
    ? `${addr.slice(0, 6)}…${addr.slice(-4)}`
    : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

function matchesCreatorSlug(song: Song, creatorSlug: string): boolean {
  const targetKey = normalizeSlugKey(creatorSlug);
  if (!targetKey) return false;
  if (normalizeSlugKey(song.creator) === targetKey) return true;
  const cached = readCachedProfile(song.creator);
  if (cached?.nickname && normalizeSlugKey(cached.nickname) === targetKey) return true;
  return false;
}

export const SongPage: React.FC<Props> = ({ creatorSlug, songSlug, onBack }) => {
  const { readAddress, evmAddress, svmAddress } = useSelectedUserAddress();
  const { data: publicSongs = [] } = useSongs();
  const { data: publicAlbums = [] } = usePublicAlbums();

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [remoteSong, setRemoteSong] = useState<Song | null>(null);
  const [songMeta, setSongMeta] = useState<{ bpm?: number; keyScale?: string } | null>(null);
  const [lyricsData, setLyricsData] = useState<PublicLyrics | null>(null);
  const [coldLoading, setColdLoading] = useState(false);
  const [coldError, setColdError] = useState<string | null>(null);

  const [imgError, setImgError] = useState(false);
  const [isPlayingThis, setIsPlayingThis] = useState(false);
  const [storeDuration, setStoreDuration] = useState(0);
  const [localRatio, setLocalRatio] = useState(0);
  const [lockedTimestampSec, setLockedTimestampSec] = useState<number | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [activeComment, setActiveComment] = useState<Comment | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);
  const [shareData, setShareData] = useState<MintShareData | null>(null);
  const [showVideoLyrics, setShowVideoLyrics] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Instant synchronous resolution from existing client song caches (<16ms first paint)
  const allKnownSongs = useMemo<Song[]>(() => {
    const map = new Map<string, Song>();
    for (const s of publicSongs) {
      if (s?.id) map.set(s.id, s);
    }
    const storeState = store.getState();
    for (const s of storeState.songs) {
      if (s?.id && !map.has(s.id)) map.set(s.id, s);
    }
    if (storeState.activeSong?.id && !map.has(storeState.activeSong.id)) {
      map.set(storeState.activeSong.id, storeState.activeSong);
    }
    if (remoteSong?.id) {
      map.set(remoteSong.id, remoteSong);
    }
    return Array.from(map.values());
  }, [publicSongs, remoteSong]);

  const matchedBaseSong = useMemo<Song | null>(() => {
    const targetSongKey = normalizeSlugKey(songSlug);
    if (!targetSongKey) return null;

    const candidates = allKnownSongs.filter(
      (s) => s.id === songSlug || normalizeSlugKey(s.title) === targetSongKey
    );
    if (candidates.length === 0) return remoteSong;

    const creatorMatch = candidates.find((s) => matchesCreatorSlug(s, creatorSlug));
    return creatorMatch ?? candidates[0];
  }, [allKnownSongs, creatorSlug, songSlug, remoteSong]);

  const versions = useMemo<Song[]>(() => {
    if (!matchedBaseSong) return [];
    const grouped = groupSongs(allKnownSongs);
    const family = matchedBaseSong.family ?? matchedBaseSong.id;
    const found = grouped.find(
      (group) =>
        group.some((v) => v.id === matchedBaseSong.id) ||
        (group[0]?.family ?? group[0]?.id) === family
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

  // Reset version selection when URL slug changes
  useEffect(() => {
    setSelectedVersionId(null);
    setRemoteSong(null);
    setSongMeta(null);
    setLyricsData(null);
    setColdError(null);
    setLockedTimestampSec(null);
    setActiveComment(null);
    setThreadOpen(false);
  }, [creatorSlug, songSlug]);

  useEffect(() => {
    setImgError(false);
  }, [song?.id, song?.image]);

  // Independent process 1: Song record resolution (refreshes video/metadata or hydrates cold deep-links via /api/songs/:id)
  const songLookupKey = song?.id || songSlug;
  const viewerKey = readAddress?.trim().toLowerCase() || '';
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
        setRemoteSong(data.song as Song);
        const takes: any[] = Array.isArray(data.takes) ? data.takes : [];
        const baseTake =
          takes.find((t) => t?.is_active && !t?.stem_id) ??
          takes.find((t) => t?.task === 'text2music') ??
          takes.find((t) => t?.is_active) ??
          takes[0];
        const params = (baseTake?.provenance?.parameters ?? {}) as Record<string, any>;
        const submitted = (params.submitted ?? params) as Record<string, any>;
        const resolved = (params.resolved ?? {}) as Record<string, any>;
        const rawBpm = Number(submitted.bpm ?? resolved.bpm);
        const rawKey = String(submitted.keyScale ?? submitted.keyscale ?? resolved.keyscale ?? '').trim();
        setSongMeta({
          bpm: Number.isFinite(rawBpm) && rawBpm >= 30 && rawBpm <= 260 ? Math.round(rawBpm) : undefined,
          keyScale: rawKey && rawKey.toLowerCase() !== 'unknown' ? rawKey : undefined,
        });
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

  // Independent process 2: Public synced lyrics via decoupled Scribe /api/lyrics/:id endpoint
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
          if (data.status === 'transcribing' && attempts < 12) {
            attempts += 1;
            pollTimer = setTimeout(loadLyrics, 2500);
          }
        })
        .catch(() => {
          // Lyrics are independent & optional; playback continues normally
        });
    };

    loadLyrics();
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
    readAddress
  );

  // Sync playhead & playing state directly from Rawchunks global audio store (zero teardown churn)
  useEffect(() => {
    if (!song?.id) {
      setIsPlayingThis(false);
      setStoreDuration(0);
      setLocalRatio(0);
      return;
    }
    const sync = () => {
      const s = store.getState();
      const active = s.activeSong?.id === song.id;
      const playing = active && s.isPlaying;
      setIsPlayingThis(playing);
      if (active) {
        if (s.duration > 0) setStoreDuration(s.duration);
        const dur = s.duration > 0 ? s.duration : song.duration || 60;
        const livePos = audio.position();
        const pos = livePos !== null ? livePos : s.playhead;
        setLocalRatio(dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0);
      } else {
        setStoreDuration(0);
        setLocalRatio(0);
      }
    };
    sync();
    return store.subscribe(sync);
  }, [song?.id, song?.duration]);

  const effectiveDuration = useMemo(() => {
    if (storeDuration > 0) return storeDuration;
    if (song?.duration && song.duration > 0) return song.duration;
    return 120;
  }, [storeDuration, song?.duration]);

  const currentSec = useMemo(
    () => Math.max(0, Math.min(effectiveDuration, localRatio * effectiveDuration)),
    [localRatio, effectiveDuration]
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
      } catch {
        // Ignore seek while buffering
      }
    }
  }, []);

  // Release background video buffers cleanly on unmount
  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (v) {
        try {
          v.pause();
          v.removeAttribute('src');
          v.load();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Crisp 10 Hz karaoke playhead & strictly muted saved background video sync (zero 60fps render churn!)
  useEffect(() => {
    const vid = videoRef.current;
    if (!isPlayingThis) {
      if (vid && !vid.paused) {
        try {
          vid.pause();
        } catch {
          // ignore
        }
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
            } catch {
              // ignore
            }
          }
          if (v.paused) {
            void v.play().catch(() => {});
          }
        }
      }
    };

    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [isPlayingThis, effectiveDuration, song?.video]);

  // Play/Pause toggle (works across Market, paused, and deep-linked states)
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
    const queueList = versions.length > 1 ? versions : [song];
    void store.playSong(song, queueList, null, `song:${song.id}`);
  }, [song, versions]);

  // Waveform click-to-seek controller
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
        const queueList = versions.length > 1 ? versions : [song];
        void store.playSong(song, queueList, null, `song:${song.id}`).then((ok) => {
          if (ok) store.setPlayhead(targetSec);
        });
      } else {
        store.setPlayhead(targetSec);
        if (!s.isPlaying) {
          void store.setPlaying(true);
        }
      }
    },
    [song, versions, effectiveDuration, syncVideoTo]
  );

  const handleJumpToTimestamp = useCallback(
    (sec: number) => {
      const ratio = effectiveDuration > 0 ? Math.max(0, Math.min(1, sec / effectiveDuration)) : 0;
      handleWaveformSeek(ratio);
    },
    [effectiveDuration, handleWaveformSeek]
  );

  // Clean synced sung lyrics from independent /api/lyrics/:id (structured `isTag: false` lines only, zero [bracketed] notes)
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
    // Exact line matching playhead
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
    // Most recent line whose start <= currentSec
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

  // Auto-surface timed comment near playhead during playback (exact Timeline behavior)
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
    } catch {
      // Handled by hook toast
    }
  };

  const creatorHandle =
    creatorProfile.nickname?.trim() ||
    (creatorSlug && !creatorSlug.startsWith('0x') ? creatorSlug : song?.creator || creatorSlug);
  const creatorLabel =
    creatorProfile.nickname?.trim() ||
    (creatorSlug && !creatorSlug.startsWith('0x') && creatorSlug.length < 28
      ? creatorSlug
      : formatShortAddr(song?.creator || creatorSlug));

  const openShareModal = useCallback(
    (targetSong?: Song) => {
      const s = targetSong ?? song;
      if (!s) return;
      setShareData(songToShareData(s, creatorHandle, false, albumCover));
    },
    [song, creatorHandle, albumCover]
  );

  // Cold deep-link not found / initial cold fetch
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

  // Compute crisp focal slice around active line (5 lines on non-video stage, 3 lines on video ribbon)
  const focusRadius = hasSavedVideo ? 1 : 2;
  const centerIdx = Math.max(0, activeLineIndex);
  const sliceStart = Math.max(0, Math.min(centerIdx - focusRadius, Math.max(0, cleanLyricLines.length - (focusRadius * 2 + 1))));
  const sliceEnd = Math.min(cleanLyricLines.length, sliceStart + focusRadius * 2 + 1);
  const visibleLyricLines = cleanLyricLines.slice(sliceStart, sliceEnd);

  return (
    <div
      className={`song-page ${hasSavedVideo ? 'has-video' : ''} ${hasLyrics || isTranscribingLyrics ? 'has-lyrics' : ''} ${isPlayingThis ? 'is-playing' : ''}`}
    >
      {/* Full-bleed strictly muted background video when creator saved one from Workspace */}
      {hasSavedVideo ? (
        <div className="song-bg-layer" aria-hidden="true">
          <video
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

      {/* Self-contained viewport foreground — ZERO outer page scroll */}
      <div className="song-foreground">
        {/* Top Row: Creator Studio Back, Lyrics Toggle (on video), Creator Identity, Follow & Share */}
        <header className="song-topbar">
          <button
            type="button"
            className="creator-back-btn"
            onClick={onBack}
            aria-label={`Back to ${creatorLabel}`}
          >
            <ArrowLeft size={13} />
            <span>{creatorLabel}</span>
          </button>

          <div className="song-topbar-right">
            {hasSavedVideo && hasLyrics && (
              <Tooltip title={showVideoLyrics ? 'Hide synced lyrics' : 'Show synced lyrics'}>
                <button
                  type="button"
                  className={`song-lyrics-toggle ${showVideoLyrics ? 'active' : ''}`}
                  onClick={() => setShowVideoLyrics((v) => !v)}
                  aria-label="Toggle synced lyrics"
                >
                  <Captions size={13} />
                  <span>LYRICS</span>
                </button>
              </Tooltip>
            )}

            <button
              type="button"
              className="song-creator-pill"
              onClick={() => navigateToCreator(creatorHandle)}
              title={`Open ${creatorLabel}`}
            >
              {creatorProfile.avatar ? (
                <img src={creatorProfile.avatar} alt="" className="song-creator-avatar" />
              ) : (
                <User size={12} />
              )}
              <span>{creatorLabel}</span>
            </button>

            {!isSelfCreator && song.creator && (
              <button
                type="button"
                className={`creator-follow-btn ${isFollowing ? 'is-following' : ''}`}
                onClick={(e) => toggleFollow(e)}
              >
                {isFollowing ? (
                  <>
                    <UserCheck size={13} />
                    <span>FOLLOWING</span>
                  </>
                ) : (
                  <>
                    <UserPlus size={13} />
                    <span>FOLLOW</span>
                  </>
                )}
              </button>
            )}

            <Tooltip title="Share track">
              <button
                type="button"
                className="creator-share-btn"
                onClick={() => openShareModal(song)}
                aria-label="Share track"
              >
                <Share2 size={13} />
              </button>
            </Tooltip>
          </div>
        </header>

        {/* Center Stage:
            - Without video: 2-column Cover Art + Real Scribe v3 Word-Synced Karaoke Lyrics (or centered Cover Art if instrumental)
            - With video: Open full-bleed video canvas + optional sleek 3-line karaoke lyric ribbon */}
        <section className="song-center-stage" aria-label="Track stage">
          {!hasSavedVideo ? (
            <div className={`song-showcase ${hasLyrics || isTranscribingLyrics ? 'is-split' : ''}`}>
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
                    <Pause size={26} />
                  ) : (
                    <Play size={26} className="market-play-icon-offset" />
                  )}
                </span>
              </button>

              {hasLyrics ? (
                <div className="song-lyrics-stage" aria-label="Synced lyrics" aria-live="polite">
                  <div className="song-lyrics-window">
                    {visibleLyricLines.map((line) => {
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
              ) : isTranscribingLyrics ? (
                <div className="song-lyrics-stage is-syncing" aria-live="polite">
                  <div className="song-lyrics-syncing-pill">
                    <Loader2 size={13} className="song-spin" />
                    <span>SYNCING VOCAL LYRICS…</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : hasLyrics && showVideoLyrics ? (
            <div className="song-video-lyrics-ribbon" aria-label="Synced lyrics" aria-live="polite">
              {visibleLyricLines.map((line) => {
                const role =
                  line.index < activeLineIndex
                    ? 'past'
                    : line.index === activeLineIndex
                      ? 'active'
                      : 'upcoming';
                return renderKaraokeLine(line, role);
              })}
            </div>
          ) : null}
        </section>

        {/* Bottom Deck: Exact Rawchunks Timeline Component Language */}
        <article
          className={`creator-timeline-card song-deck ${isPlayingThis ? 'is-playing' : ''}`}
          data-guide-entity={song.id}
        >
          <div className="timeline-header">
            <button
              type="button"
              className={`timeline-cover-btn ${isPlayingThis ? 'active' : ''}`}
              data-guide="card.stream"
              onClick={handlePlayToggle}
              aria-label={isPlayingThis ? `Pause ${song.title}` : `Play ${song.title}`}
            >
              {coverSrc ? (
                <img
                  src={coverSrc}
                  alt={song.title}
                  className="timeline-cover-img"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="timeline-cover-fallback">
                  <img src="/branding/mark.svg" alt="" className="timeline-fallback-mark" />
                </div>
              )}
              <span className="timeline-play-circle">
                {isPlayingThis ? (
                  <Pause size={15} />
                ) : (
                  <Play size={15} className="market-play-icon-offset" />
                )}
              </span>
            </button>

            <div className="timeline-title-cluster">
              <div className="timeline-title-row">
                <h1 className="timeline-song-title song-deck-title">{song.title}</h1>
                {versions.length > 1 && (
                  <div className="timeline-versions-slot">
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
                  </div>
                )}
              </div>

              <div className="timeline-meta-row">
                <span className="timeline-time-readout">
                  {formatDuration(currentSec)} / {formatDuration(effectiveDuration)}
                </span>
                {typeof song.plays === 'number' && song.plays > 0 && (
                  <span className="timeline-stat-pill" title={`${song.plays} streams`}>
                    <Headphones size={11} />
                    <span>{song.plays}</span>
                  </span>
                )}
                {songMeta?.bpm ? (
                  <span className="timeline-stat-pill">{songMeta.bpm} BPM</span>
                ) : null}
                {songMeta?.keyScale ? (
                  <span className="timeline-stat-pill">{songMeta.keyScale}</span>
                ) : null}
                {tags.map((t) => (
                  <Badge key={t} variant="muted">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="timeline-actions-cluster">
              <LikeButton songId={song.id} likesCount={song.likes} showCount />
              <PlaylistAdder song={song} onShare={openShareModal} />
              <Tooltip title="Timed comments">
                <button
                  type="button"
                  className={`timeline-thread-toggle ${threadOpen ? 'active' : ''}`}
                  onClick={() => setThreadOpen((prev) => !prev)}
                  aria-label={`Timed comments (${totalComments})`}
                >
                  <MessageSquare size={12} />
                  <span>{totalComments}</span>
                </button>
              </Tooltip>
              <Licenses key={song.id} song={song} placement="market" compact />
            </div>
          </div>

          <div className="timeline-waveform-stage">
            <Waveform
              audioUrl={song.url}
              timelineDuration={effectiveDuration}
              interactive={false}
              showSelection={false}
              height={54}
              progress={localRatio}
              onSeek={handleWaveformSeek}
              className="timeline-base-waveform"
            />

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

          <form className="timeline-composer" onSubmit={handleSubmitComment}>
            <button
              type="button"
              className={`timeline-thread-toggle timeline-composer-comments ${threadOpen ? 'active' : ''}`}
              onClick={() => setThreadOpen((prev) => !prev)}
              aria-label={`Timed comments (${totalComments})`}
            >
              <MessageSquare size={12} />
              <span>{totalComments}</span>
            </button>

            <button
              type="button"
              className={`timeline-timestamp-lock ${lockedTimestampSec !== null ? 'locked' : ''}`}
              onClick={() =>
                setLockedTimestampSec((prev) =>
                  prev !== null ? null : Number(currentSec.toFixed(1))
                )
              }
              title="Lock or unlock comment timestamp"
            >
              <Clock size={11} />
              <span>@{formatDuration(targetCommentSec)}</span>
            </button>

            <input
              type="text"
              className="timeline-composer-input"
              placeholder={`Comment at @${formatDuration(targetCommentSec)}…`}
              value={commentBody}
              onFocus={() => {
                if (lockedTimestampSec === null) {
                  setLockedTimestampSec(Number(currentSec.toFixed(1)));
                }
              }}
              onChange={(e) => setCommentBody(e.target.value)}
              maxLength={280}
            />

            <button
              type="submit"
              className="timeline-composer-send"
              disabled={isPosting || !commentBody.trim()}
              aria-label="Post timed comment"
            >
              <Send size={12} />
            </button>
          </form>
        </article>
      </div>

      {/* Existing Rawchunks ShareModal (shares /${creatorSlug}/${songSlug}) */}
      <ShareModal
        isOpen={Boolean(shareData)}
        onClose={() => setShareData(null)}
        data={shareData}
      />

      {/* Chronological Timed Comments Modal (keeps song page 100% scroll-free) */}
      <Modal
        isOpen={threadOpen}
        onClose={() => setThreadOpen(false)}
        title={`TIMED COMMENTS (${totalComments})`}
        size="sm"
      >
        <div className="song-comments-modal-list">
          {comments.length === 0 ? (
            <div className="timeline-thread-empty">
              Tap anywhere on the waveform to drop the first timed note.
            </div>
          ) : (
            comments.map((c) => {
              const authorLabel = c.author_nickname?.trim() || formatShortAddr(c.author);
              const isMine =
                Boolean(readAddress) &&
                c.author.trim().toLowerCase() === readAddress!.trim().toLowerCase();
              return (
                <div key={c.id} className="timeline-thread-item">
                  <button
                    type="button"
                    className="timeline-comment-time-badge"
                    onClick={() => {
                      handleJumpToTimestamp(c.timestamp_sec);
                      setThreadOpen(false);
                    }}
                  >
                    @{formatDuration(c.timestamp_sec)}
                  </button>
                  <button
                    type="button"
                    className="timeline-thread-author"
                    onClick={() => {
                      setThreadOpen(false);
                      navigateToCreator(c.author);
                    }}
                  >
                    {c.author_avatar ? (
                      <img src={c.author_avatar} alt="" className="timeline-thread-avatar" />
                    ) : (
                      <User size={10} />
                    )}
                    <span>{authorLabel}</span>
                  </button>
                  <span className="timeline-thread-text">{c.body}</span>
                  {isMine && (
                    <button
                      type="button"
                      className="timeline-thread-delete"
                      onClick={() => {
                        setActiveComment((prev) => (prev?.id === c.id ? null : prev));
                        void deleteComment(c.id);
                      }}
                      aria-label="Delete comment"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Modal>
    </div>
  );
};

export default SongPage;
