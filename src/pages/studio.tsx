import { sdk, watch } from '@/lib/sdk';
import React, { useState, useEffect, useRef } from 'react';
import { Glitch } from '../components/glitch';
import { Button } from '../components/button';
import { Badge } from '../components/badge';
import { store, State } from '../lib/store';
import { Song, Track, Album } from '../lib/schema';
import { readSongs, writeSongs } from '../lib/cache';
import { useSelectedUserAddress } from '../hooks/use-address';
import { useDisclaimerConsent } from '../hooks/use-disclaimer';
import { usePublic } from '../hooks/use-public';
import { useSession, promptSessionModal } from '../components/session';
import { toast } from 'sonner';
import { Modal } from '../components/modal';
import { Languages } from '../components/languages';
import { Tooltip } from '../components/daw/Tooltip';
import { Mic2, UploadCloud, FileAudio, Play, Pause, Sliders, Globe, Lock } from 'lucide-react';
import { useOptions } from '@/hooks/use-options';
import { useVoices, voiceReady, voiceStatus } from '@/hooks/use-voices';
import {
  parseLyricsToBlocks,
  serializeBlocksToLyrics,
  createBlock,
  ensureTagBrackets,
  getTagCategory,
  getTagDescription,
  STRUCTURED_TAGS,
  CATEGORY_METADATA,
  LyricBlock,
  LyricCategory,
} from '../lib/lyrics';

export interface Props {
  onEditSong?: (song: Song) => void;
  className?: string;
}

export const Studio: React.FC<Props> = ({ onEditSong, className = '' }) => {
  const [state, setState] = useState<State>(store.getState());
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [instrumental, setInstrumental] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [model, setModel] = useState('turbo');
  const options = useOptions();
  const generation = options.data?.generation;
  useEffect(() => { if (generation && !generation.modes.some(mode => mode.id === model)) setModel(generation.modes[0].id); }, [generation, model]);
  const [useVoice, setUseVoice] = useState(false);
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const currentVoiceFile = useRef<File | null>(null);
  const [voiceMode, setVoiceMode] = useState<'reference' | 'trained'>('reference');
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [voiceTab, setVoiceTab] = useState<'saved' | 'upload'>('saved');
  const [isDraggingVoice, setIsDraggingVoice] = useState(false);
  const uploadedVoice = useRef<{ file: File; creator: string; id: string } | null>(null);
  const [, setUploadedVoiceId] = useState<string | null>(null);
  const scopeRef = useRef(0);
  const streamRef = useRef<AbortController | null>(null);
  const [streamPrice, setStreamPrice] = useState(0.01);
  const [licensePrice, setLicensePrice] = useState(5.0);
  const [licenses, setLicenses] = useState(20);
  const [mobilePocket, setMobilePocket] = useState<'create' | 'feed'>('create');

  // Cover generation & Album association
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>('');
  const [showNewAlbumModal, setShowNewAlbumModal] = useState(false);
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [creatingAlbum, setCreatingAlbum] = useState(false);

  // Single-expanded accordion section (strictly one open at a time)
  const [activeSection, setActiveSection] = useState<'details' | 'params' | 'financials'>('details');
  const [studioFlow, setStudioFlow] = useState<'vibe' | 'control'>('vibe');
  const [isVibing, setIsVibing] = useState(false);
  const [vibeStep, setVibeStep] = useState<string | null>(null);
  const [vibeImage, setVibeImage] = useState<string | null>(null);
  const [vibeImageName, setVibeImageName] = useState<string | null>(null);
  const [isDraggingVibeImage, setIsDraggingVibeImage] = useState(false);
  const vibeFileInputRef = useRef<HTMLInputElement>(null);
  const [vibeAudio, setVibeAudio] = useState<string | null>(null);
  const [vibeAudioDuration, setVibeAudioDuration] = useState<number>(0);
  const [isRecordingVibeAudio, setIsRecordingVibeAudio] = useState(false);
  const [vibeRecordingSeconds, setVibeRecordingSeconds] = useState(0);
  const [isPlayingVibeAudio, setIsPlayingVibeAudio] = useState(false);
  const vibeAudioRecRef = useRef<{
    stream: MediaStream;
    ctx: AudioContext;
    processor: ScriptProcessorNode;
    source: MediaStreamAudioSourceNode;
    chunks: Float32Array[];
    sampleRate: number;
    timer: number;
    startedAt: number;
  } | null>(null);
  const vibeAudioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const vibeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onGuideAction = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.type !== 'studio-section') return;
      setMobilePocket('create');
      setStudioFlow('control');
      if (detail.section === 'core' || detail.section === 'details') {
        setActiveSection('details');
      } else if (detail.section === 'params') {
        setActiveSection('params');
      } else if (detail.section === 'financials') {
        setActiveSection('financials');
      }
    };
    window.addEventListener('rawchunks:guide-action', onGuideAction);
    return () => window.removeEventListener('rawchunks:guide-action', onGuideAction);
  }, []);

  // Selectable parameters modal state
  const [activeModal, setActiveModal] = useState<'duration' | 'bpm' | 'key' | 'voice' | 'language' | 'lyrics' | 'cover' | null>(null);
  const [audioDurationSeconds, setAudioDurationSeconds] = useState<number | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [keyScale, setKeyScale] = useState<string>('');
  const [selectedRootNote, setSelectedRootNote] = useState<string>('');
  const [selectedScaleMode, setSelectedScaleMode] = useState<string>('minor');
  const [voiceCoverStrength, setVoiceCoverStrength] = useState<number>(0.65);
  const coverFileInputRef = useRef<HTMLInputElement>(null);
  const voiceFileInputRef = useRef<HTMLInputElement>(null);

  // Structured Lyrics Canvas state
  const [lyricsBlocks, setLyricsBlocks] = useState<LyricBlock[]>([]);
  const [lyricsRawText, setLyricsRawText] = useState('');
  const [lyricsMode, setLyricsMode] = useState<'canvas' | 'raw'>('canvas');
  const [lyricsPaletteCategory, setLyricsPaletteCategory] = useState<LyricCategory | 'all' | null>(null);
  const [insertingSepIndex, setInsertingSepIndex] = useState<number | null>(null);
  const [addingTagBlockId, setAddingTagBlockId] = useState<string | null>(null);

  const handleOpenLyricsModal = () => {
    const blocks = parseLyricsToBlocks(lyrics);
    setLyricsBlocks(blocks);
    setLyricsRawText(lyrics);
    setLyricsMode('canvas');
    setLyricsPaletteCategory(null);
    setInsertingSepIndex(null);
    setAddingTagBlockId(null);
    setActiveModal('lyrics');
  };

  const handleTogglePaletteCategory = (cat: LyricCategory | 'all') => {
    setLyricsPaletteCategory((prev) => (prev === cat ? null : cat));
  };

  const handleSwitchLyricsMode = (mode: 'canvas' | 'raw') => {
    if (mode === 'raw') {
      setLyricsRawText(serializeBlocksToLyrics(lyricsBlocks, lyricsRawText));
    } else {
      setLyricsBlocks(parseLyricsToBlocks(lyricsRawText));
    }
    setLyricsMode(mode);
  };

  const handleUpdateBlockText = (id: string, text: string) => {
    setLyricsBlocks((prev) =>
      prev.map((block) => (block.id === id ? { ...block, text } : block))
    );
  };

  const handleAddTagToBlock = (blockId: string, rawTag: string) => {
    const tag = ensureTagBrackets(rawTag);
    setLyricsBlocks((prev) =>
      prev.map((block) => {
        if (block.id !== blockId) return block;
        if (block.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return block;
        return { ...block, tags: [...block.tags, tag] };
      })
    );
    setAddingTagBlockId(null);
  };

  const handleRemoveTag = (blockId: string, tagIndex: number) => {
    setLyricsBlocks((prev) =>
      prev.map((block) => {
        if (block.id !== blockId) return block;
        const nextTags = [...block.tags];
        nextTags.splice(tagIndex, 1);
        return { ...block, tags: nextTags };
      })
    );
  };

  const handleInsertSection = (index: number, rawTag?: string) => {
    const newBlock = createBlock(rawTag ? [rawTag] : ['[Intro]'], '');
    setLyricsBlocks((prev) => {
      const next = [...prev];
      const insertAt = Math.max(0, Math.min(index, next.length));
      next.splice(insertAt, 0, newBlock);
      return next;
    });
    setInsertingSepIndex(null);
  };

  const handleMoveBlock = (index: number, direction: 'up' | 'down') => {
    setLyricsBlocks((prev) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const handleDeleteBlock = (index: number) => {
    setLyricsBlocks((prev) => {
      if (prev.length <= 1) {
        return [createBlock(['[Intro]'], '')];
      }
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
  };

  const handleApplyLyrics = () => {
    const finalLyrics =
      lyricsMode === 'raw'
        ? lyricsRawText
        : serializeBlocksToLyrics(lyricsBlocks, lyricsRawText);
    setLyrics(finalLyrics);
    setActiveModal(null);
    toast.success('Structured lyrics updated');
  };

  const handleCoverFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsGeneratingCover(true);
    try {
      const data = new FormData();
      data.append('file', file);
      const response = await sdk.fetch('/api/generation/cover', { method: 'POST', body: data });
      const result = await response.json();
      if (!response.ok || !result.imageUrl) throw new Error(result.error || 'Could not upload cover');
      setCoverUrl(result.imageUrl);
      toast.success('Cover uploaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not upload cover');
    } finally {
      setIsGeneratingCover(false);
    }
  };

  const { userAddress: userAddr, readAddress } = useSelectedUserAddress();
  const { session, refreshSession, refreshCredits } = useSession();
  const { voices, loading: loadingVoices, error: voicesError, refresh: refreshVoices, remember: rememberVoice } = useVoices(readAddress);
  const voiceOutput = model === 'sft' ? 'sft' : 'turbo';
  const selectedVoice = voices.find(voice => voice.id === selectedVoiceId);
  const canUseVoice = voiceMode === 'reference' ? Boolean(voiceFile) : Boolean(selectedVoice && voiceReady(selectedVoice, voiceOutput));
  const voiceName = voiceMode === 'reference' ? voiceFile?.name : selectedVoice?.name;
  useEffect(() => {
    scopeRef.current++;
    return () => {
      scopeRef.current++;
      streamRef.current?.abort();
      vibeAbortRef.current?.abort();
      if (vibeAudioRecRef.current) {
        window.clearInterval(vibeAudioRecRef.current.timer);
        try {
          vibeAudioRecRef.current.processor.disconnect();
          vibeAudioRecRef.current.source.disconnect();
        } catch {
          // ignore
        }
        vibeAudioRecRef.current.stream.getTracks().forEach((t) => t.stop());
        void vibeAudioRecRef.current.ctx.close().catch(() => { });
        vibeAudioRecRef.current = null;
      }
      if (vibeAudioPlayerRef.current) {
        vibeAudioPlayerRef.current.pause();
        vibeAudioPlayerRef.current = null;
      }
      store.setGenerating(false);
    };
  }, [userAddr]);
  useEffect(() => {
    uploadedVoice.current = null;
    setUploadedVoiceId(null);
    setSelectedVoiceId('');
    setUseVoice(false);
  }, [readAddress]);

  const { toggle: togglePublic, pending: publicPending } = usePublic();
  const { hasConsented } = useDisclaimerConsent();

  useEffect(() => {
    return store.subscribe(setState);
  }, []);

  useEffect(() => {
    if (userAddr && userAddr !== state.userAddress) {
      store.setUserAddress(userAddr);
    }
  }, [userAddr, state.userAddress]);

  useEffect(() => {
    if (!userAddr) {
      setAlbums([]);
      setSelectedAlbumId('');
      return;
    }
    sdk.fetch(`/api/albums?creator=${encodeURIComponent(userAddr)}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAlbums(data);
        }
      })
      .catch((err) => console.error('Failed to fetch albums:', err));
  }, [userAddr]);

  const handleGenerateCover = async () => {
    const coverPromptSeed = prompt.trim() || lyrics.trim().slice(0, 200) || title.trim();
    if (!coverPromptSeed) {
      toast.error('Enter a prompt or lyrics first to generate cover');
      return;
    }
    if (!session.active) {
      toast.error('Active session required to generate cover. Please create a session.');
      promptSessionModal();
      return;
    }
    setIsGeneratingCover(true);
    try {
      const res = await sdk.fetch('/api/generation/cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: coverPromptSeed,
          title: title.trim() || undefined,
          style: activeTags.length ? activeTags.join(', ') : undefined,
        }),
      });
      if (res.status === 402) {
        toast.error('Active session required or session budget exhausted. Please top up your session.');
        promptSessionModal();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate cover');
      setCoverUrl(data.imageUrl);
      toast.success('Cover generated');
    } catch (err: any) {
      toast.error(err.message || 'Error generating cover');
    } finally {
      setIsGeneratingCover(false);
    }
  };

  const handleCreateAlbum = async () => {
    if (!userAddr) {
      toast.error('Connect wallet required');
      return;
    }
    if (!newAlbumTitle.trim()) return;
    setCreatingAlbum(true);
    try {
      const res = await sdk.fetch('/api/albums', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newAlbumTitle.trim(),
          creator: userAddr,
        }),
      });
      const album: Album = await res.json();
      if (!res.ok) throw new Error((album as any).error || 'Failed to create album');
      setAlbums((prev) => [album, ...prev]);
      setSelectedAlbumId(album.id);
      setShowNewAlbumModal(false);
      setNewAlbumTitle('');
      toast.success('Album created');
    } catch (err: any) {
      toast.error(err.message || 'Error creating album');
    } finally {
      setCreatingAlbum(false);
    }
  };

  const toggleTag = (tag: string) => {
    if (activeTags.includes(tag)) {
      setActiveTags(activeTags.filter((t) => t !== tag));
    } else {
      if (activeTags.length < 5) {
        setActiveTags([...activeTags, tag]);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      uploadedVoice.current = null;
      setUploadedVoiceId(null);
      setVoiceFile(files[0]);
      currentVoiceFile.current = files[0];
      setVoiceMode('reference');
    }
  };

  const canSubmitGeneration = instrumental
    ? prompt.trim().length >= 3
    : prompt.trim().length >= 3 || lyrics.trim().length >= 3;

  const canSubmitVibe =
    prompt.trim().length >= 2 || Boolean(vibeImage) || Boolean(vibeAudio) || isRecordingVibeAudio;

  const encodeWav16kMonoDataUrl = (chunks: Float32Array[], sourceRate: number): { dataUrl: string; durationSec: number } => {
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const targetRate = 16000;
    const ratio = sourceRate / targetRate;
    const outLength = Math.max(1, Math.round(totalLength / ratio));
    const resampled = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const idx1 = Math.min(totalLength - 1, idx0 + 1);
      const frac = srcIdx - idx0;
      resampled[i] = merged[idx0] * (1 - frac) + merged[idx1] * frac;
    }

    const buffer = new ArrayBuffer(44 + outLength * 2);
    const view = new DataView(buffer);
    const writeAscii = (pos: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(pos + i, str.charCodeAt(i));
    };

    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + outLength * 2, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, targetRate, true);
    view.setUint32(28, targetRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, 'data');
    view.setUint32(40, outLength * 2, true);

    for (let i = 0; i < outLength; i++) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    return {
      dataUrl: `data:audio/wav;base64,${base64}`,
      durationSec: Math.max(1, Math.round(outLength / targetRate)),
    };
  };

  const stopVibeAudioRecording = (): { dataUrl: string; durationSec: number } | null => {
    const rec = vibeAudioRecRef.current;
    if (!rec) {
      setIsRecordingVibeAudio(false);
      return null;
    }
    vibeAudioRecRef.current = null;
    window.clearInterval(rec.timer);
    try {
      rec.processor.disconnect();
      rec.source.disconnect();
    } catch {
      // ignore
    }
    rec.stream.getTracks().forEach((t) => t.stop());
    void rec.ctx.close().catch(() => { });
    setIsRecordingVibeAudio(false);

    if (rec.chunks.length === 0) return null;
    const encoded = encodeWav16kMonoDataUrl(rec.chunks, rec.sampleRate);
    setVibeAudio(encoded.dataUrl);
    setVibeAudioDuration(encoded.durationSec);
    return encoded;
  };

  const startVibeAudioRecording = async () => {
    if (isRecordingVibeAudio) {
      stopVibeAudioRecording();
      return;
    }
    if (vibeAudioPlayerRef.current) {
      vibeAudioPlayerRef.current.pause();
      vibeAudioPlayerRef.current = null;
      setIsPlayingVibeAudio(false);
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];

      processor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(input));
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      const startedAt = Date.now();
      setVibeRecordingSeconds(0);
      setIsRecordingVibeAudio(true);

      const timer = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setVibeRecordingSeconds(elapsed);
        if (elapsed >= 30) {
          stopVibeAudioRecording();
        }
      }, 250);

      vibeAudioRecRef.current = {
        stream,
        ctx,
        processor,
        source,
        chunks,
        sampleRate: ctx.sampleRate || 44100,
        timer,
        startedAt,
      };
    } catch {
      toast.error('Microphone access is required to record a hum or voice prompt');
    }
  };

  const togglePlayVibeAudio = () => {
    if (!vibeAudio) return;
    if (isPlayingVibeAudio && vibeAudioPlayerRef.current) {
      vibeAudioPlayerRef.current.pause();
      vibeAudioPlayerRef.current = null;
      setIsPlayingVibeAudio(false);
      return;
    }
    const audioEl = new Audio(vibeAudio);
    vibeAudioPlayerRef.current = audioEl;
    setIsPlayingVibeAudio(true);
    audioEl.onended = () => {
      setIsPlayingVibeAudio(false);
      vibeAudioPlayerRef.current = null;
    };
    audioEl.onerror = () => {
      setIsPlayingVibeAudio(false);
      vibeAudioPlayerRef.current = null;
    };
    void audioEl.play().catch(() => {
      setIsPlayingVibeAudio(false);
      vibeAudioPlayerRef.current = null;
    });
  };

  const clearVibeAudio = () => {
    if (isRecordingVibeAudio) {
      stopVibeAudioRecording();
    }
    if (vibeAudioPlayerRef.current) {
      vibeAudioPlayerRef.current.pause();
      vibeAudioPlayerRef.current = null;
    }
    setIsPlayingVibeAudio(false);
    setVibeAudio(null);
    setVibeAudioDuration(0);
    setVibeRecordingSeconds(0);
  };

  const formatShortSec = (sec: number) => {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  };

  const attachVibeImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select a valid image file');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error('Could not read image file');
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        try {
          const maxEdge = 768;
          let { width, height } = img;
          if (width > maxEdge || height > maxEdge) {
            if (width >= height) {
              height = Math.max(1, Math.round((height * maxEdge) / width));
              width = maxEdge;
            } else {
              width = Math.max(1, Math.round((width * maxEdge) / height));
              height = maxEdge;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            setVibeImage(dataUrl);
            setVibeImageName(file.name);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          setVibeImage(canvas.toDataURL('image/jpeg', 0.82));
          setVibeImageName(file.name);
        } catch {
          setVibeImage(dataUrl);
          setVibeImageName(file.name);
        }
      };
      img.onerror = () => {
        setVibeImage(dataUrl);
        setVibeImageName(file.name);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleVibeImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      attachVibeImageFile(file);
    }
    e.target.value = '';
  };

  const handleVibe = async () => {
    const trimmedPrompt = prompt.trim();
    if (isVibing || state.isGenerating || !canSubmitVibe) return;

    let activeAudio = vibeAudio;
    if (isRecordingVibeAudio) {
      const finalized = stopVibeAudioRecording();
      activeAudio = finalized?.dataUrl || activeAudio;
    }

    if (trimmedPrompt.length < 2 && !vibeImage && !activeAudio) return;

    if (!userAddr) {
      toast.error('Connect wallet required to vibe');
      return;
    }

    if (!hasConsented) {
      toast.error('Disclaimer signature required prior to generation');
      return;
    }

    if (!session.active) {
      toast.error('Active session required to run Songwriter. Please create a session.');
      promptSessionModal();
      return;
    }

    const controller = new AbortController();
    vibeAbortRef.current?.abort();
    vibeAbortRef.current = controller;

    setIsVibing(true);
    setVibeStep(
      vibeImage && activeAudio
        ? 'Analyzing image and voice/hum vibe...'
        : activeAudio
          ? 'Analyzing voice/hum rhythm, mood, and words...'
          : vibeImage
            ? 'Translating image into song prompt...'
            : 'Starting Songwriter Agent...'
    );
    setStudioFlow('control');
    setActiveSection('details');

    try {
      const res = await sdk.fetch('/api/vibe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        userAddress: userAddr,
        signal: controller.signal,
        body: JSON.stringify({
          prompt: trimmedPrompt || undefined,
          image: vibeImage || undefined,
          audio: activeAudio || undefined,
          modelVariant: model === 'sft' ? 'sft' : 'turbo',
        }),
      });

      if (!res.ok) {
        if (res.status === 402) {
          toast.error('Active session required or session budget exhausted. Please top up your session.');
          promptSessionModal();
          return;
        }
        const errData = await res.json().catch(() => ({ error: 'Songwriter Agent failed' }));
        throw new Error(errData.error || 'Songwriter Agent failed');
      }

      if (!res.body) {
        throw new Error('Songwriter stream is unavailable');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const applyEvent = (event: any) => {
        if (!event || typeof event !== 'object') return;
        if (event.type === 'status') {
          setVibeStep(event.step || event.message || 'Vibing...');
          return;
        }
        if (event.type === 'lyrics_start') {
          setLyrics('');
          setVibeStep('Writing lyrics...');
          return;
        }
        if (event.type === 'lyrics_delta' && typeof event.delta === 'string') {
          setLyrics((prev) => prev + event.delta);
          return;
        }
        if (event.type === 'cover_start') {
          setIsGeneratingCover(true);
          return;
        }
        if (event.type === 'cover') {
          setIsGeneratingCover(false);
          if (typeof event.imageUrl === 'string' && event.imageUrl) {
            setCoverUrl(event.imageUrl);
          }
          return;
        }
        if (event.type === 'field') {
          const { field, value } = event;
          if (field === 'title' && typeof value === 'string') {
            setTitle(value);
          } else if (field === 'prompt' && typeof value === 'string') {
            setPrompt(value);
          } else if (field === 'instrumental') {
            setInstrumental(Boolean(value));
          } else if (field === 'vocalLanguage') {
            setSelectedLanguage(value ? String(value) : null);
          } else if (field === 'lyrics' && typeof value === 'string') {
            setLyrics(value);
          } else if (field === 'tags' && Array.isArray(value)) {
            setActiveTags(value.map((t: unknown) => String(t).toUpperCase()).slice(0, 5));
          } else if (field === 'bpm') {
            setBpm(typeof value === 'number' && Number.isFinite(value) ? value : null);
          } else if (field === 'keyScale' && typeof value === 'string') {
            setKeyScale(value);
            const parts = value.trim().split(/\s+/);
            if (parts[0]) setSelectedRootNote(parts[0]);
            if (parts[1]) setSelectedScaleMode(parts[1].toLowerCase());
          } else if (field === 'audioDuration') {
            setAudioDurationSeconds(typeof value === 'number' && Number.isFinite(value) ? value : null);
          }
          return;
        }
        if (event.type === 'error') {
          setIsGeneratingCover(false);
          toast.error(event.message || 'Songwriter Agent encountered an error');
          return;
        }
        if (event.type === 'done') {
          setIsGeneratingCover(false);
          toast.success('Songwriter Agent populated your studio');
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (line) {
            try {
              applyEvent(JSON.parse(line));
            } catch {
              // ignore malformed partial line
            }
          }
        }
      }

      const trailing = buffer.trim();
      if (trailing) {
        try {
          applyEvent(JSON.parse(trailing));
        } catch {
          // ignore
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        toast.error(err?.message || 'Error running Songwriter Agent');
      }
    } finally {
      setIsVibing(false);
      setVibeStep(null);
      setIsGeneratingCover(false);
      if (vibeAbortRef.current === controller) {
        vibeAbortRef.current = null;
      }
      void refreshSession().catch(() => { });
      void refreshCredits().catch(() => { });
    }
  };

  const handleGenerate = () => {
    if (state.isGenerating || isGeneratingCover || isVibing || !canSubmitGeneration) return;

    if (!userAddr) {
      toast.error('Connect wallet required to generate');
      return;
    }

    if (!hasConsented) {
      toast.error('Disclaimer signature required prior to generation');
      return;
    }

    if (!session.active) {
      toast.error('Active session required to generate music. Please create a session.');
      promptSessionModal();
      return;
    }

    if (useVoice && !canUseVoice) {
      toast.error(voiceMode === 'trained' ? `This voice is not ready for ${voiceOutput === 'turbo' ? 'Fast' : 'Master'}` : 'Choose a voice sample');
      return;
    }

    void executeGenerate();
  };

  const executeGenerate = async () => {
    if (!userAddr) { toast.error('Connect your wallet'); return; }
    const scope = scopeRef.current;
    store.setGenerating(true);

    try {
      if (!generation || !model) throw new Error('Music options are unavailable');
      const modelVariant = model;

      let voiceId: string | undefined;
      if (useVoice) {
        if (voiceMode === 'trained') {
          if (!selectedVoice || !voiceReady(selectedVoice, voiceOutput)) throw new Error(`This voice is not ready for ${voiceOutput === 'turbo' ? 'Fast' : 'Master'}`);
          voiceId = selectedVoice.id;
        } else {
          if (!voiceFile) throw new Error('Choose a voice sample');
          const saved = uploadedVoice.current;
          if (saved?.file === voiceFile && saved.creator === userAddr) {
            voiceId = saved.id;
          } else {
            const formData = new FormData();
            formData.append('creator', userAddr);
            formData.append('name', voiceFile.name.replace(/\.[^/.]+$/, ''));
            formData.append('file', voiceFile);
            const response = await sdk.fetch('/api/voices/upload', { method: 'POST', body: formData, userAddress: userAddr });
            if (response.status === 402) {
              store.setGenerating(false);
              toast.error('Active session required or session budget exhausted. Please top up your session.');
              promptSessionModal();
              return;
            }
            const result = await response.json();
            if (!response.ok || !result.voice?.id) throw new Error(result.error || 'Could not upload voice sample');
            if (scope !== scopeRef.current) return;
            const savedVoice = rememberVoice(result.voice);
            if (!savedVoice.sample_url) throw new Error('Voice sample is unavailable');
            if (currentVoiceFile.current === voiceFile) {
              uploadedVoice.current = { file: voiceFile, creator: userAddr, id: savedVoice.id };
              setUploadedVoiceId(savedVoice.id);
            }
            voiceId = savedVoice.id;
            void refreshVoices();
          }
        }
      }
      if (scope !== scopeRef.current) return;

      const res = await sdk.fetch('/api/generation/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorAddress: userAddr,
          title: title.trim() || undefined,
          image: coverUrl || undefined,
          albumId: selectedAlbumId || undefined,
          prompt,
          lyrics: instrumental ? undefined : (lyrics.trim() ? lyrics : undefined),
          instrumental,
          vocalLanguage: selectedLanguage && !instrumental ? selectedLanguage : undefined,
          modelVariant,
          tags: activeTags,
          licenses,
          stream_price: streamPrice,
          license_price: licensePrice,
          audioDuration: audioDurationSeconds || undefined,
          bpm: bpm || undefined,
          keyScale: keyScale.trim() || undefined,
          ...(useVoice ? { voiceId, voiceMode, voiceCoverStrength } : {}),
        }),
      });

      if (!res.ok) {
        if (res.status === 402) {
          store.setGenerating(false);
          toast.error('Active session required or session budget exhausted. Please top up your session.');
          promptSessionModal();
          return;
        }
        const err = await res.json().catch(() => ({ error: 'Failed to start generation' }));
        throw new Error(err.error || 'Failed to dispatch generation task');
      }

      const { taskId, songId } = await res.json();
      const now = Date.now();
      const untitledCount = (state.songs || []).filter((s) => s.title && s.title.startsWith('Untitled')).length;
      const baseTitle = title.trim() || `Untitled #${untitledCount + 1}`;

      const songA: Song = {
        id: songId,
        title: baseTitle,
        duration: audioDurationSeconds || undefined,
        tags: activeTags,
        creator: userAddr,
        public: false,
        image: coverUrl || '/hero.png',
        album_id: selectedAlbumId || null,
        licenses: licenses,
        stream_price: streamPrice,
        license_price: licensePrice,
        url: '',
      };

      const trackAId = `trk-${now}-1`;

      store.addTracks([
        { id: trackAId, song: songA, variation: 1, status: 'generating', progress: 15 },
      ]);
      setMobilePocket('feed');

      toast.info('Generating tracks...');

      const controller = new AbortController();
      streamRef.current?.abort(); streamRef.current = controller;
      try {
        await watch(`/api/generation/events/${encodeURIComponent(taskId)}?songId=${encodeURIComponent(songId)}`, controller.signal, async result => {
          if (scope !== scopeRef.current) return true;
          if (!result.status) return false;
          if (result.status === 'ready') {
            if (!Array.isArray(result.audioUrls) || !result.audioUrls.length || result.audioUrls.some((url: unknown) => typeof url !== 'string' || !url)) throw new Error('Generation returned no audio');
            const songs: Song[] = [];
            for (let index = 0; index < result.audioUrls.length; index++) {
              const id = index === 0 ? result.songAId : result.songBId;
              if (!id) throw new Error('Generation returned no song ID');
              const song = {
                ...songA,
                id,
                url: result.audioUrls[index],
                duration: result.durations?.[index],
                title: `${baseTitle}${result.audioUrls.length > 1 ? ` (Var ${index + 1})` : ''}`,
                image: coverUrl || '/hero.png',
                album_id: selectedAlbumId || null,
              };
              store.addSong(song); songs.push(song);
              if (index === 0) store.updateTrack(trackAId, { status: 'ready', progress: 100, song });
              else store.addTracks([{ id: `${trackAId}-${index}`, song, variation: 2, status: 'ready', progress: 100 }]);
            }
            const cached = readSongs(userAddr) ?? [];
            writeSongs([...songs, ...cached.filter(song => !songs.some(result => result.id === song.id))], userAddr);
            store.setActiveSong(songs[0]); store.setGenerating(false);
            toast.success('Song ready');
            return true;
          } else if (result.status === 'error') {
            throw new Error(result.error || 'Generation failed');
          } else {
            store.updateTrack(trackAId, { progress: result.progress ?? 0 });
          }
          return false;
        });
      } catch (error) {
        if (scope !== scopeRef.current) return;
        store.setGenerating(false); store.updateTrack(trackAId, { status: 'error', progress: 0 });
        toast.error(error instanceof Error ? error.message : 'Could not follow generation');
      } finally { if (streamRef.current === controller) streamRef.current = null; }

    } catch (err: any) {
      if (scope !== scopeRef.current) return;
      store.setGenerating(false);
      toast.error(err.message || 'Generation error');
    }
  };

  const handleSaveVoice = async (track: Track) => {
    if (!userAddr) {
      toast.error('Connect wallet required');
      return;
    }
    if (!session.active) {
      toast.error('Active session required to save voice. Please create a session.');
      promptSessionModal();
      return;
    }
    const scope = scopeRef.current;
    try {
      toast.info('Saving voice...');
      const res = await sdk.fetch('/api/voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        userAddress: userAddr,
        body: JSON.stringify({
          songId: track.song.id,
          creator: userAddr,
          name: `${track.song.title.slice(0, 20)} Voice`,
        }),
      });
      if (res.status === 402) {
        toast.error('Active session required or session budget exhausted. Please top up your session.');
        promptSessionModal();
        return;
      }
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to save voice');
      if (scope !== scopeRef.current) return;
      const savedVoice = rememberVoice(result.voice);
      toast.info(`${savedVoice.name}: ${voiceStatus(savedVoice).toLowerCase()}`);
      void refreshVoices();
    } catch (err: any) {
      if (scope !== scopeRef.current) return;
      toast.error(err.message || 'Error saving voice');
    }
  };

  return (
    <div
      className={`studio-container ${className}`}
      data-pocket={mobilePocket}
    >
      {/* Mobile Pocket Tab Switcher */}
      <div className="studio-pocket-bar">
        <button
          type="button"
          className={`studio-pocket-btn ${mobilePocket === 'create' ? 'active' : ''}`}
          onClick={() => setMobilePocket('create')}
        >
          <span>✦ CREATE</span>
        </button>
        <button
          type="button"
          className={`studio-pocket-btn ${mobilePocket === 'feed' ? 'active' : ''}`}
          onClick={() => setMobilePocket('feed')}
        >
          <span>FEED ({state.tracks.length})</span>
        </button>
      </div>

      {/* Control Configuration Panel */}
      <div className="studio-panel-config panel">
        <div className="studio-panel-header">
          <Glitch text="STUDIO_CREATE" />
          <div className="studio-mode-badge-switch" role="group" aria-label="Studio Flow">
            <button
              type="button"
              className={`studio-mode-badge-btn mode-vibe ${studioFlow === 'vibe' ? 'active' : ''}`}
              onClick={() => setStudioFlow('vibe')}
            >
              VIBE
            </button>
            <button
              type="button"
              className={`studio-mode-badge-btn mode-control ${studioFlow === 'control' ? 'active' : ''}`}
              onClick={() => setStudioFlow('control')}
            >
              CONTROL
            </button>
          </div>
        </div>
        {options.error && <span role="alert">{options.error.message}</span>}
        {isVibing && vibeStep && (
          <div className="studio-vibe-live-banner" role="status" aria-live="polite">
            <span className="studio-vibe-live-dot" />
            <span className="studio-vibe-live-text">{vibeStep}</span>
          </div>
        )}

        {/* Self-Contained Unified Form (VIBE or CONTROL) */}
        <div className="studio-accordion">
          {studioFlow === 'vibe' ? (
            <div className="studio-card-section details active">
              <div className="studio-card-body">
                <div className="studio-field-group studio-field-group-vibe-prompt">
                  <label className="studio-field-label">
                    <span>PROMPT</span>
                    <span className="studio-field-optional">
                      {vibeImage || vibeAudio || isRecordingVibeAudio
                        ? 'OPTIONAL'
                        : 'REQUIRED (OR IMAGE / HUM)'}
                    </span>
                  </label>
                  <textarea
                    className="cyber-input-field studio-vibe-textarea"
                    placeholder="Describe your song idea/vibe/story — or attach an image or record a hum/voice below..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </div>

                <div className="studio-vibe-media-grid">
                  <div className="studio-field-group studio-vibe-image-group">
                    <label className="studio-field-label">
                      <span>IMAGE PROMPT</span>
                      <span className="studio-field-optional">OPTIONAL</span>
                    </label>
                    <input
                      type="file"
                      ref={vibeFileInputRef}
                      accept="image/*"
                      className="hidden-file-input"
                      onChange={handleVibeImageChange}
                    />
                    {vibeImage ? (
                      <div className="studio-vibe-image-card">
                        <div
                          className="studio-vibe-image-info"
                          onClick={() => vibeFileInputRef.current?.click()}
                        >
                          <img
                            src={vibeImage}
                            alt="Visual vibe prompt"
                            className="studio-vibe-image-thumb"
                          />
                          <div className="studio-vibe-image-meta">
                            <span className="studio-vibe-image-name">
                              {vibeImageName || 'IMAGE'}
                            </span>
                          </div>
                        </div>
                        <div className="studio-vibe-image-actions">
                          <button
                            type="button"
                            className="daw-ui-btn studio-vibe-image-clear"
                            onClick={() => {
                              setVibeImage(null);
                              setVibeImageName(null);
                            }}
                            title="Remove image prompt"
                            aria-label="Remove image prompt"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`studio-vibe-dropzone ${isDraggingVibeImage ? 'drag-over' : ''}`}
                        onClick={() => vibeFileInputRef.current?.click()}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDraggingVibeImage(true);
                        }}
                        onDragLeave={() => setIsDraggingVibeImage(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDraggingVibeImage(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file) void attachVibeImageFile(file);
                        }}
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="studio-vibe-dropzone-icon"
                        >
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                        <span className="studio-vibe-dropzone-text">
                          UPLOAD IMAGE
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="studio-field-group studio-vibe-image-group">
                    <label className="studio-field-label">
                      <span>HUM / VOICE</span>
                      <span className="studio-field-optional">OPTIONAL</span>
                    </label>
                    {isRecordingVibeAudio ? (
                      <button
                        type="button"
                        className="studio-vibe-dropzone studio-vibe-audio-recording"
                        onClick={() => stopVibeAudioRecording()}
                      >
                        <span className="studio-vibe-rec-dot" />
                        <span className="studio-vibe-dropzone-text">
                          STOP · {formatShortSec(vibeRecordingSeconds)}
                        </span>
                      </button>
                    ) : vibeAudio ? (
                      <div className="studio-vibe-image-card studio-vibe-audio-card">
                        <div
                          className="studio-vibe-image-info"
                          onClick={togglePlayVibeAudio}
                          title={isPlayingVibeAudio ? 'Pause preview' : 'Play preview'}
                        >
                          <span className="studio-vibe-audio-play-badge">
                            {isPlayingVibeAudio ? '❚❚' : '▶'}
                          </span>
                          <div className="studio-vibe-image-meta">
                            <span className="studio-vibe-image-name">
                              HUM · {formatShortSec(vibeAudioDuration)}
                            </span>
                          </div>
                        </div>
                        <div className="studio-vibe-image-actions">
                          <button
                            type="button"
                            className="daw-ui-btn"
                            onClick={() => void startVibeAudioRecording()}
                            title="Re-record hum or voice"
                          >
                            MIC
                          </button>
                          <button
                            type="button"
                            className="daw-ui-btn studio-vibe-image-clear"
                            onClick={clearVibeAudio}
                            title="Remove voice/hum prompt"
                            aria-label="Remove voice/hum prompt"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="studio-vibe-dropzone studio-vibe-audio-trigger"
                        onClick={() => void startVibeAudioRecording()}
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="studio-vibe-dropzone-icon"
                        >
                          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" y1="19" x2="12" y2="22" />
                        </svg>
                        <span className="studio-vibe-dropzone-text">
                          RECORD HUM / VOICE
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* 1. DETAILS Section */}
              <div className={`studio-card-section details ${activeSection === 'details' ? 'active' : ''}`}>
                <div
                  className="studio-card-header"
                  onClick={() => setActiveSection('details')}
                >
                  <div className="studio-card-header-left">
                    <span className="studio-card-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#00ccff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                        <rect x="9" y="9" width="6" height="6" />
                        <line x1="9" y1="1" x2="9" y2="4" />
                        <line x1="15" y1="1" x2="15" y2="4" />
                        <line x1="9" y1="20" x2="9" y2="23" />
                        <line x1="15" y1="20" x2="15" y2="23" />
                        <line x1="20" y1="9" x2="23" y2="9" />
                        <line x1="20" y1="14" x2="23" y2="14" />
                        <line x1="1" y1="9" x2="4" y2="9" />
                        <line x1="1" y1="14" x2="4" y2="14" />
                      </svg>
                    </span>
                    <span className="studio-card-title">DETAILS</span>
                    <span className="studio-card-badge">CORE</span>
                  </div>
                  <span className="studio-card-chevron">▲</span>
                </div>

                {activeSection === 'details' && (
                  <div className="studio-card-body">
                    {/* Aligned Identity Inputs & Avatar Upload Frame */}
                    <div className="studio-identity-grid">
                      <div className="studio-identity-inputs">
                        <div className="studio-field-group">
                          <label className="studio-field-label">
                            <span>TITLE</span>
                            <span className="studio-field-optional">OPTIONAL</span>
                          </label>
                          <input
                            type="text"
                            className="cyber-input-field"
                            placeholder="Untitled"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                          />
                        </div>

                        <div className="studio-field-group">
                          <label className="studio-field-label">
                            <span>ALBUM</span>
                            <span className="studio-field-optional">OPTIONAL</span>
                          </label>
                          <select
                            className="cyber-input-field"
                            value={selectedAlbumId}
                            onChange={(e) => {
                              if (e.target.value === '__NEW__') {
                                setShowNewAlbumModal(true);
                              } else {
                                setSelectedAlbumId(e.target.value);
                              }
                            }}
                          >
                            <option value="">NONE</option>
                            {albums.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.title}
                              </option>
                            ))}
                            <option value="__NEW__">+ NEW ALBUM...</option>
                          </select>
                        </div>
                      </div>

                      <div className={`studio-avatar-box ${coverUrl ? 'has-image' : ''}`}>
                        <input
                          type="file"
                          ref={coverFileInputRef}
                          accept="image/*"
                          className="hidden-file-input"
                          onChange={handleCoverFileUpload}
                        />
                        {coverUrl ? (
                          <>
                            <img
                              src={coverUrl}
                              alt="Cover preview"
                              className="studio-avatar-preview"
                              onClick={() => setActiveModal('cover')}
                              title="Expand cover"
                            />
                            <button
                              type="button"
                              className="studio-avatar-remove"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCoverUrl(null);
                                if (coverFileInputRef.current) {
                                  coverFileInputRef.current.value = '';
                                }
                              }}
                              title="Remove cover"
                            >
                              ✕
                            </button>
                            <button
                              type="button"
                              className="studio-avatar-sparkle-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleGenerateCover();
                              }}
                              disabled={isGeneratingCover || (!prompt.trim() && !lyrics.trim() && !title.trim())}
                              title="Regenerate Cover with AI"
                            >
                              {isGeneratingCover ? '...' : (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                                </svg>
                              )}
                            </button>
                          </>
                        ) : (
                          <>
                            <div
                              className="studio-avatar-upload-trigger"
                              onClick={() => coverFileInputRef.current?.click()}
                            >
                              <span className="studio-avatar-upload-icon">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00ccff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                  <polyline points="17 8 12 3 7 8" />
                                  <line x1="12" y1="3" x2="12" y2="15" />
                                </svg>
                              </span>
                              <span className="studio-avatar-label">UPLOAD COVER</span>
                            </div>
                            <button
                              type="button"
                              className="studio-avatar-sparkle-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleGenerateCover();
                              }}
                              disabled={isGeneratingCover || (!prompt.trim() && !lyrics.trim() && !title.trim())}
                              title="Generate Cover with AI"
                            >
                              {isGeneratingCover ? '...' : (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                                </svg>
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Prompt Input */}
                    <div className="studio-field-group studio-field-group-prompt">
                      <label className="studio-field-label">
                        <span>PROMPT</span>
                        <span className="studio-field-optional">
                          {instrumental ? 'REQUIRED' : lyrics.trim().length >= 3 ? 'OPTIONAL' : 'OR LYRICS'}
                        </span>
                      </label>
                      <textarea
                        className="cyber-input-field"
                        placeholder="Describe style, rhythm, soundscapes, instruments..."
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                      />
                    </div>

                    {/* Lyrics Input */}
                    <div className="studio-field-group studio-field-group-lyrics">
                      <div className="studio-lyrics-row">
                        <label className="studio-field-label studio-field-label-flush">
                          <span>LYRICS</span>
                          <span className="studio-field-optional">
                            {instrumental ? '(MUTED)' : prompt.trim().length >= 3 ? '(OPTIONAL)' : '(OR PROMPT)'}
                          </span>
                        </label>
                        <div className="studio-lyrics-toggles">
                          <label className={`studio-checkbox-label ${instrumental ? 'disabled' : ''}`}>
                            <input
                              type="checkbox"
                              checked={instrumental}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setInstrumental(checked);
                              }}
                              className="cyber-checkbox"
                            />
                            <span>INSTRUMENTAL</span>
                          </label>

                          <button
                            type="button"
                            disabled={instrumental}
                            className={`studio-param-pill-mini ${selectedLanguage ? 'configured' : ''}`}
                            onClick={() => setActiveModal('language')}
                            title="Configure Vocal Language"
                          >
                            <span className="studio-param-pill-label">LANGUAGE:</span>
                            <span className="studio-param-pill-val">
                              {instrumental ? 'MUTED' : selectedLanguage ? selectedLanguage.toUpperCase() : 'AUTO'}
                            </span>
                            <span className="studio-param-pill-icon">⚙</span>
                          </button>
                        </div>
                      </div>
                      {instrumental ? (
                        <div className="studio-instrumental-strip">
                          INSTRUMENTAL ONLY — VOCAL SYNTHESIS MUTED
                        </div>
                      ) : (
                        <div className="studio-lyrics-box-wrap">
                          <textarea
                            className="cyber-input-field studio-lyrics-box-textarea"
                            placeholder="Enter custom lyrics or leave empty for auto-generated lyrics..."
                            value={lyrics}
                            onChange={(e) => setLyrics(e.target.value)}
                          />
                          <button
                            type="button"
                            className={`studio-lyrics-box-expand-btn ${lyrics.trim() ? 'configured' : ''}`}
                            onClick={handleOpenLyricsModal}
                            title="Expand Structured Lyrics Canvas"
                            aria-label="Expand Structured Lyrics Canvas"
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="15 3 21 3 21 9" />
                              <polyline points="9 21 3 21 3 15" />
                              <line x1="21" y1="3" x2="14" y2="10" />
                              <line x1="3" y1="21" x2="10" y2="14" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. PARAMETERS Section */}
              <div className={`studio-card-section params ${activeSection === 'params' ? 'active' : ''}`}>
                <div
                  className="studio-card-header"
                  onClick={() => setActiveSection('params')}
                >
                  <div className="studio-card-header-left">
                    <span className="studio-card-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#00ff41" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="4" y1="21" x2="4" y2="14" />
                        <line x1="4" y1="10" x2="4" y2="3" />
                        <line x1="12" y1="21" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12" y2="3" />
                        <line x1="20" y1="21" x2="20" y2="16" />
                        <line x1="20" y1="12" x2="20" y2="3" />
                        <line x1="1" y1="14" x2="7" y2="14" />
                        <line x1="9" y1="8" x2="15" y2="8" />
                        <line x1="17" y1="16" x2="23" y2="16" />
                      </svg>
                    </span>
                    <span className="studio-card-title">GLOBAL PARAMETERS</span>
                    <span className="studio-card-badge">{activeTags.length} TAGS</span>
                  </div>
                  <span className="studio-card-chevron">▲</span>
                </div>

                {activeSection === 'params' && (
                  <div className="studio-card-body">
                    {/* Tags Selection */}
                    <div className="studio-field-group">
                      <label className="studio-field-label">
                        <span>STYLE TAGS</span>
                        <span className="studio-field-optional">({activeTags.length}/5 SELECTED)</span>
                      </label>
                      <div className="studio-tags-container">
                        {(options.data?.editing?.promptTags ?? []).map((rawTag) => {
                          const t = rawTag.toUpperCase();
                          const isSelected = activeTags.includes(t);
                          return (
                            <Badge
                              key={t}
                              clickable
                              active={isSelected}
                              variant={isSelected ? 'primary' : 'muted'}
                              onClick={() => toggleTag(t)}
                            >
                              {t}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>

                    {/* 2x2 Parameter Trigger Cards (Modals) */}
                    <div className="studio-params-pills-grid">
                      <button
                        type="button"
                        className={`studio-param-pill ${audioDurationSeconds ? 'configured' : ''}`}
                        onClick={() => setActiveModal('duration')}
                      >
                        <div className="studio-param-pill-header">
                          <span className="studio-param-pill-label">DURATION</span>
                          <span className="studio-param-pill-icon">⚙</span>
                        </div>
                        <div className="studio-param-pill-val">
                          {audioDurationSeconds ? `${audioDurationSeconds}s` : '120s (DEFAULT)'}
                        </div>
                      </button>

                      <button
                        type="button"
                        className={`studio-param-pill ${bpm ? 'configured' : ''}`}
                        onClick={() => setActiveModal('bpm')}
                      >
                        <div className="studio-param-pill-header">
                          <span className="studio-param-pill-label">TEMPO (BPM)</span>
                          <span className="studio-param-pill-icon">⚙</span>
                        </div>
                        <div className="studio-param-pill-val">
                          {bpm ? `${bpm} BPM` : 'AUTO'}
                        </div>
                      </button>

                      <button
                        type="button"
                        className={`studio-param-pill ${keyScale ? 'configured' : ''}`}
                        onClick={() => setActiveModal('key')}
                      >
                        <div className="studio-param-pill-header">
                          <span className="studio-param-pill-label">KEY & SCALE</span>
                          <span className="studio-param-pill-icon">⚙</span>
                        </div>
                        <div className="studio-param-pill-val">
                          {keyScale || 'AUTO'}
                        </div>
                      </button>

                      <button
                        type="button"
                        className={`studio-param-pill ${useVoice && voiceName ? 'configured' : ''}`}
                        onClick={() => setActiveModal('voice')}
                      >
                        <div className="studio-param-pill-header">
                          <span className="studio-param-pill-label">VOICE</span>
                          <span className="studio-param-pill-icon">⚙</span>
                        </div>
                        <div className="studio-param-pill-val">
                          {useVoice && voiceName ? voiceName : 'DEFAULT'}
                        </div>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. FINANCIALS Section */}
              <div className={`studio-card-section financials ${activeSection === 'financials' ? 'active' : ''}`}>
                <div
                  className="studio-card-header"
                  onClick={() => setActiveSection('financials')}
                >
                  <div className="studio-card-header-left">
                    <span className="studio-card-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ff00a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </span>
                    <span className="studio-card-title">FINANCIALS</span>
                    <span className="studio-card-badge">RATES</span>
                  </div>
                  <span className="studio-card-chevron">▲</span>
                </div>

                {activeSection === 'financials' && (
                  <div className="studio-card-body">
                    <div className="studio-pricing-grid">
                      <div className="studio-pricing-input-wrap">
                        <label className="studio-field-label">
                          STREAM ($/MIN)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={streamPrice.toString()}
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value);
                            if (!isNaN(parsed) && parsed > 0) setStreamPrice(parsed);
                          }}
                          className="cyber-input-field"
                        />
                      </div>
                      <div className="studio-pricing-input-wrap">
                        <label className="studio-field-label">
                          LICENSE ($)
                        </label>
                        <input
                          type="number"
                          step="1"
                          value={licensePrice.toString()}
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value);
                            if (!isNaN(parsed) && parsed > 0) setLicensePrice(parsed);
                          }}
                          className="cyber-input-field"
                        />
                      </div>
                      <div className="studio-pricing-input-wrap">
                        <label className="studio-field-label">
                          LICENSES
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="1"
                          value={licenses.toString()}
                          onChange={(e) => {
                            const parsed = parseInt(e.target.value, 10);
                            if (!isNaN(parsed) && parsed >= 0) setLicenses(parsed);
                          }}
                          className="cyber-input-field"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Inner FAST | MASTER selector & Main Action Button */}
        <div className="studio-main-action-wrap">
          <div className="studio-inner-mode-switch" role="group" aria-label="Generation Mode">
            {(generation?.modes
              .slice()
              .sort((a, b) => Number(b.id === 'turbo') - Number(a.id === 'turbo')) ?? [
                { id: 'turbo' },
                { id: 'sft' },
              ]).map((mode) => {
                const isFast = mode.id === 'turbo';
                const isActive = model === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    className={`studio-mode-badge-btn ${isFast ? 'mode-fast' : 'mode-master'} ${isActive ? 'active' : ''}`}
                    onClick={() => setModel(mode.id)}
                  >
                    {isFast ? 'FAST' : 'MASTER'}
                  </button>
                );
              })}
          </div>
          {studioFlow === 'vibe' ? (
            <Button
              variant="primary"
              size="lg"
              disabled={isVibing || state.isGenerating || isGeneratingCover || !canSubmitVibe}
              onClick={handleVibe}
              className="studio-generate-btn studio-vibe-btn"
            >
              {isVibing ? 'VIBING...' : 'VIBE'}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              disabled={state.isGenerating || isGeneratingCover || isVibing || !canSubmitGeneration || !generation || !model}
              onClick={handleGenerate}
              className="studio-generate-btn"
            >
              {isVibing ? 'VIBING...' : state.isGenerating ? 'SYNTHESIZING...' : 'GENERATE AUDIO'}
            </Button>
          )}
        </div>
      </div>

      {/* Generated Variations List */}
      <div className="studio-panel-feed panel scrollable">
        <div className="studio-feed-header">
          <Glitch text="VARIATIONS_FEED" />
          <span className="studio-feed-count">{state.tracks.length} GENERATIONS</span>
        </div>

        {state.tracks.length === 0 ? (
          <div className="studio-empty-state">
            <span className="studio-empty-title">NO VARIATIONS YET</span>
            <span className="studio-empty-desc">
              Configure instructions and synthesize your first track.
            </span>
          </div>
        ) : (
          <div className="studio-variations-list">
            {state.tracks.map((t) => {
              const isPlayingThis = state.activeSong?.id === t.song.id && state.isPlaying;
              return (
                <div
                  key={t.id}
                  className={`variation-card ${state.activeSong?.id === t.song.id ? 'active' : ''}`}
                >
                  <div className="variation-card-row-top">
                    <div className="variation-card-track-info">
                      <Tooltip title={isPlayingThis ? 'Pause' : 'Play'} description="Preview generated track">
                        <Button
                          variant={isPlayingThis ? 'primary' : 'ghost'}
                          size="sm"
                          aria-label={isPlayingThis ? 'PAUSE' : 'PLAY'}
                          disabled={t.status !== 'ready' || !t.song.url}
                          onClick={() => {
                            if (isPlayingThis) {
                              store.setPlaying(false);
                            } else {
                              store.setActiveSong(t.song);
                              store.setPlaying(true);
                            }
                          }}
                        >
                          {isPlayingThis ? <Pause size={13} /> : <Play size={13} />}
                        </Button>
                      </Tooltip>
                      <div className="variation-card-text">
                        <div className="variation-card-title">{t.song.title}</div>
                        <div className="variation-card-meta">
                          {t.song.tags.join(' // ')}{t.song.duration ? ` • ${t.song.duration}s` : ''}
                        </div>
                      </div>
                    </div>

                    <Badge variant={t.status === 'ready' ? 'primary' : t.status === 'error' ? 'muted' : 'warning'}>
                      {t.status === 'ready' ? 'READY' : t.status === 'error' ? 'ERROR' : `SYNTHESIZING (${t.progress}%)`}
                    </Badge>
                  </div>

                  <div className="variation-card-row-bottom">
                    <div className="variation-card-pricing">
                      <span>STREAM: ${t.song.stream_price.toFixed(2)}/m</span>
                      <span>LICENSE: ${t.song.license_price.toFixed(2)}</span>
                    </div>

                    <div className="variation-card-actions">
                      {t.status === 'ready' && (
                        <>
                          {onEditSong && (
                            <Tooltip title="Edit in DAW" description="Open multitrack workstation">
                              <Button
                                variant="ghost"
                                size="xs"
                                aria-label="EDIT"
                                onClick={() => onEditSong(t.song)}
                              >
                                <Sliders size={12} />
                              </Button>
                            </Tooltip>
                          )}
                          <Tooltip title="Save Voice" description="Extract vocal timbre profile from track">
                            <Button
                              variant="ghost"
                              size="xs"
                              aria-label="SAVE VOICE"
                              onClick={() => handleSaveVoice(t)}
                            >
                              <Mic2 size={12} />
                            </Button>
                          </Tooltip>
                          <Tooltip
                            title={t.song.public ? 'Make Private' : 'Make Public'}
                            description={t.song.public ? 'Hide from public Market' : 'Publish to public Market'}
                          >
                            <Button
                              variant={t.song.public ? 'secondary' : 'ghost'}
                              size="xs"
                              aria-label={t.song.public ? 'MAKE PRIVATE' : 'MAKE PUBLIC'}
                              disabled={Boolean(publicPending)}
                              onClick={() => togglePublic(t.song)}
                            >
                              {t.song.public ? <Globe size={12} /> : <Lock size={12} />}
                            </Button>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>



      {/* New Album Modal */}
      <Modal
        isOpen={showNewAlbumModal}
        onClose={() => {
          setShowNewAlbumModal(false);
          setNewAlbumTitle('');
        }}
        title="NEW ALBUM"
      >
        <div className="studio-new-album-body">
          <div className="studio-field-group">
            <label className="studio-field-label">TITLE</label>
            <input
              type="text"
              className="cyber-input-field"
              placeholder="Album title"
              value={newAlbumTitle}
              onChange={(e) => setNewAlbumTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="studio-new-album-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowNewAlbumModal(false);
                setNewAlbumTitle('');
              }}
            >
              CANCEL
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={creatingAlbum || !newAlbumTitle.trim()}
              onClick={handleCreateAlbum}
            >
              {creatingAlbum ? 'CREATING...' : 'CREATE'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Duration Modal */}
      <Modal
        isOpen={activeModal === 'duration'}
        onClose={() => setActiveModal(null)}
        title="DURATION"
      >
        <div className="studio-param-modal-content">
          <div className="studio-param-presets-grid">
            {[30, 60, 90, 120, 180, 240, 300].map((sec) => (
              <Tooltip
                key={sec}
                title={`${sec} SECONDS`}
                description={sec >= 60 ? `${sec / 60} minute${sec > 60 ? 's' : ''}` : `${sec} seconds`}
              >
                <Button
                  variant={audioDurationSeconds === sec ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setAudioDurationSeconds(sec)}
                >
                  {sec}s
                </Button>
              </Tooltip>
            ))}
          </div>

          <div className="studio-param-slider-wrap">
            <div className="studio-field-label">
              <span>DURATION</span>
              <span className="studio-highlight">{audioDurationSeconds ? `${audioDurationSeconds}s` : '120s'}</span>
            </div>
            <input
              type="range"
              min="15"
              max="300"
              step="5"
              value={audioDurationSeconds ?? 120}
              onChange={(e) => setAudioDurationSeconds(parseInt(e.target.value, 10))}
              className="cyber-slider"
            />
          </div>

          <div className="studio-param-actions-row">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAudioDurationSeconds(null);
                setActiveModal(null);
              }}
            >
              RESET
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setActiveModal(null)}
            >
              DONE
            </Button>
          </div>
        </div>
      </Modal>

      {/* BPM / Tempo Modal */}
      <Modal
        isOpen={activeModal === 'bpm'}
        onClose={() => setActiveModal(null)}
        title="TEMPO"
      >
        <div className="studio-param-modal-content">
          <div className="studio-param-presets-grid">
            {[
              { val: 80, label: '80 BPM', desc: 'Downtempo' },
              { val: 110, label: '110 BPM', desc: 'Midtempo' },
              { val: 128, label: '128 BPM', desc: 'House' },
              { val: 140, label: '140 BPM', desc: 'Techno' },
              { val: 160, label: '160 BPM', desc: 'Hardcore' },
              { val: 174, label: '174 BPM', desc: 'Drum & Bass' },
            ].map((p) => (
              <Tooltip key={p.val} title={p.label} description={p.desc}>
                <Button
                  variant={bpm === p.val ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setBpm(p.val)}
                >
                  {p.label}
                </Button>
              </Tooltip>
            ))}
          </div>

          <div className="studio-param-slider-wrap">
            <div className="studio-field-label">
              <span>TEMPO</span>
              <span className="studio-highlight">{bpm ? `${bpm} BPM` : 'AUTO'}</span>
            </div>
            <input
              type="range"
              min="40"
              max="220"
              step="1"
              value={bpm ?? 120}
              onChange={(e) => setBpm(parseInt(e.target.value, 10))}
              className="cyber-slider"
            />
          </div>

          <div className="studio-param-actions-row">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setBpm(null);
                setActiveModal(null);
              }}
            >
              AUTO
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setActiveModal(null)}
            >
              DONE
            </Button>
          </div>
        </div>
      </Modal>

      {/* Key & Scale Modal */}
      <Modal
        isOpen={activeModal === 'key'}
        onClose={() => setActiveModal(null)}
        title="KEY"
      >
        <div className="studio-param-modal-content">
          <div className="studio-field-label">ROOT</div>
          <div className="studio-param-presets-grid keys">
            {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((n) => (
              <Button
                key={n}
                variant={selectedRootNote === n ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setSelectedRootNote(n);
                  setKeyScale(`${n} ${selectedScaleMode}`);
                }}
              >
                {n}
              </Button>
            ))}
          </div>

          <div className="studio-field-label studio-field-label-spaced">SCALE</div>
          <div className="studio-param-presets-grid">
            {['major', 'minor', 'dorian', 'phrygian', 'mixolydian'].map((m) => (
              <Button
                key={m}
                variant={selectedScaleMode === m ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setSelectedScaleMode(m);
                  if (selectedRootNote) {
                    setKeyScale(`${selectedRootNote} ${m}`);
                  }
                }}
              >
                {m.toUpperCase()}
              </Button>
            ))}
          </div>

          <div className="studio-param-slider-wrap">
            <div className="studio-field-label">
              <span>KEY</span>
              <span className="studio-highlight">{keyScale ? keyScale.toUpperCase() : 'AUTO'}</span>
            </div>
          </div>

          <div className="studio-param-actions-row">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedRootNote('');
                setKeyScale('');
                setActiveModal(null);
              }}
            >
              AUTO
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setActiveModal(null)}
            >
              DONE
            </Button>
          </div>
        </div>
      </Modal>

      {/* Voice Modal */}
      <Modal
        isOpen={activeModal === 'voice'}
        onClose={() => setActiveModal(null)}
        title="VOICE"
        size="md"
      >
        <div className="studio-param-modal-content">
          <input
            type="file"
            ref={voiceFileInputRef}
            accept="audio/*"
            className="hidden-file-input"
            onChange={handleFileChange}
          />

          {/* Mode Switcher Tabs */}
          <div className="studio-voice-mode-switch">
            <button
              type="button"
              className={`studio-voice-mode-btn ${voiceTab === 'saved' ? 'active' : ''}`}
              onClick={() => setVoiceTab('saved')}
            >
              <Mic2 size={13} />
              <span>SAVED</span>
              <span className="studio-voice-count-badge">{voices.length}</span>
            </button>
            <button
              type="button"
              className={`studio-voice-mode-btn ${voiceTab === 'upload' ? 'active' : ''}`}
              onClick={() => setVoiceTab('upload')}
            >
              <UploadCloud size={13} />
              <span>UPLOAD</span>
            </button>
          </div>

          {/* Tab 1: Saved Voices */}
          {voiceTab === 'saved' && (
            <>
              {voicesError && (
                <div className="studio-voice-status-box error" role="alert">
                  <span className="studio-voice-status-title">{voicesError}</span>
                  <Button variant="ghost" size="xs" onClick={() => { void refreshVoices(); }}>
                    RETRY
                  </Button>
                </div>
              )}

              {loadingVoices && (
                <div className="studio-voice-status-box" role="status">
                  <span className="studio-voice-status-title">LOADING VOICES...</span>
                </div>
              )}

              {!loadingVoices && !voicesError && !readAddress && (
                <div className="studio-voice-status-box">
                  <span className="studio-voice-status-title">WALLET DISCONNECTED</span>
                  <span className="studio-voice-status-desc">Connect your wallet to access your saved custom vocal profiles.</span>
                </div>
              )}

              {!loadingVoices && !voicesError && readAddress && voices.length === 0 && (
                <div className="studio-voice-empty-state">
                  <Mic2 size={24} className="studio-voice-empty-icon" />
                  <span className="studio-voice-empty-title">NO VOICES</span>
                  <span className="studio-voice-empty-desc">
                    Upload an audio sample to use as a vocal reference, or save a vocal profile from one of your generated songs.
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setVoiceTab('upload')}
                  >
                    UPLOAD
                  </Button>
                </div>
              )}

              {!loadingVoices && !voicesError && voices.length > 0 && (
                <div className="studio-voice-list">
                  {voices.map((voice) => {
                    const isSelected = voiceMode === 'trained' && selectedVoiceId === voice.id;
                    const isReady = voiceReady(voice, voiceOutput);
                    return (
                      <button
                        type="button"
                        key={voice.id}
                        disabled={!isReady}
                        className={`studio-voice-card ${isSelected ? 'active' : ''}`}
                        onClick={() => {
                          if (isReady) {
                            setSelectedVoiceId(voice.id);
                            setVoiceMode('trained');
                            setVoiceFile(null);
                            currentVoiceFile.current = null;
                          }
                        }}
                      >
                        <div className="studio-voice-card-header">
                          <div className="studio-voice-card-title-wrap">
                            <Mic2 size={13} className="studio-voice-card-icon" />
                            <span className="studio-voice-card-name">{voice.name}</span>
                          </div>
                          <div className="studio-voice-card-badges">
                            {voice.status !== 'ready' && (
                              <Badge variant={voice.status === 'error' ? 'warning' : 'default'}>
                                {voiceStatus(voice).toUpperCase()}
                              </Badge>
                            )}
                            {isSelected && <span className="studio-voice-card-check">✓</span>}
                          </div>
                        </div>

                        {(['turbo', 'sft'] as const).map((output) => {
                          const availability = voice.availability[output];
                          const progress = availability.step != null && ['queued', 'training'].includes(availability.status);
                          if (!progress && !availability.error) return null;
                          return (
                            <span className="studio-voice-detail" key={output}>
                              {output === 'turbo' ? 'Fast' : 'Master'}: {availability.error || <>Preparing · {availability.step}{availability.total_steps != null ? ` / ${availability.total_steps}` : ''}</>}
                            </span>
                          );
                        })}
                        {voice.error && <span className="studio-voice-detail" role="alert">{voice.error}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Tab 2: Upload Sample */}
          {voiceTab === 'upload' && (
            <div className="studio-voice-upload-container">
              <div
                className={`studio-voice-upload-zone ${isDraggingVoice ? 'drag-over' : ''} ${voiceMode === 'reference' && voiceFile ? 'has-file' : ''}`}
                onClick={() => voiceFileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingVoice(true);
                }}
                onDragLeave={() => setIsDraggingVoice(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingVoice(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file && file.type.startsWith('audio/')) {
                    uploadedVoice.current = null;
                    setUploadedVoiceId(null);
                    setVoiceFile(file);
                    currentVoiceFile.current = file;
                    setVoiceMode('reference');
                    setSelectedVoiceId('');
                  } else if (file) {
                    toast.error('Please drop a valid audio file');
                  }
                }}
              >
                <UploadCloud size={24} className="studio-voice-upload-icon" />
                <span className="studio-voice-upload-title">
                  DROP OR SELECT AUDIO SAMPLE
                </span>
                <span className="studio-voice-upload-sub">
                  WAV, MP3, FLAC, OGG, WebM
                </span>
              </div>

              {voiceMode === 'reference' && voiceFile && (
                <div className="studio-voice-file-card">
                  <div className="studio-voice-file-info">
                    <FileAudio size={18} className="studio-voice-file-icon" />
                    <div className="studio-voice-file-meta">
                      <span className="studio-voice-file-name">{voiceFile.name}</span>
                      <span className="studio-voice-file-size">
                        {(voiceFile.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </div>
                  </div>
                  <div className="studio-voice-file-actions">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        voiceFileInputRef.current?.click();
                      }}
                    >
                      REPLACE
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setVoiceFile(null);
                        currentVoiceFile.current = null;
                        if (voiceFileInputRef.current) voiceFileInputRef.current.value = '';
                      }}
                    >
                      REMOVE
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Currently Selected Strip */}
          <div className="studio-voice-active-strip">
            <div className="studio-field-label studio-field-label-flush">
              <span>VOICE</span>
              <span className="studio-highlight">
                {voiceMode === 'reference' && voiceFile
                  ? voiceFile.name
                  : voiceMode === 'trained' && selectedVoice
                    ? selectedVoice.name.toUpperCase()
                    : 'NONE'}
              </span>
            </div>
          </div>

          {/* Clone Strength / Vocal Resemblance Slider */}
          {(voiceFile || selectedVoice) && (
            <div className="studio-param-slider-wrap">
              <div className="studio-field-label">
                <span>RESEMBLANCE</span>
                <span className="studio-highlight">{Math.round(voiceCoverStrength * 100)}%</span>
              </div>
              <input
                type="range"
                aria-label="Vocal resemblance"
                min="0.1"
                max="1.0"
                step="0.05"
                value={voiceCoverStrength}
                onChange={(e) => setVoiceCoverStrength(parseFloat(e.target.value))}
                className="cyber-slider"
              />
              <div className="studio-voice-slider-hint">
                <span>FREE</span>
                <span>EXACT</span>
              </div>
            </div>
          )}

          {/* Modal Actions Footer */}
          <div className="studio-param-actions-row">
            {(useVoice || voiceFile || selectedVoice) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setVoiceFile(null);
                  currentVoiceFile.current = null;
                  setSelectedVoiceId('');
                  setUploadedVoiceId(null);
                  uploadedVoice.current = null;
                  if (voiceFileInputRef.current) voiceFileInputRef.current.value = '';
                  setUseVoice(false);
                }}
              >
                CLEAR
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveModal(null)}
            >
              CANCEL
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!canUseVoice}
              onClick={() => {
                setUseVoice(true);
                setActiveModal(null);
              }}
            >
              DONE
            </Button>
          </div>
        </div>
      </Modal>

      {/* 5. Vocal Language Modal */}
      <Languages
        isOpen={activeModal === 'language'}
        onClose={() => setActiveModal(null)}
        value={selectedLanguage}
        onChange={setSelectedLanguage}
        languages={generation?.languages}
        allowAuto={true}
      />

      {/* 6. Structured Lyrics Canvas Modal */}
      <Modal
        isOpen={activeModal === 'lyrics'}
        onClose={() => setActiveModal(null)}
        title="LYRICS CANVAS"
        size="xl"
        className="studio-lyrics-modal-dialog"
      >
        <div className="studio-lyrics-modal-content">
          {/* Top Bar: Stats & Mode Switcher */}
          <div className="studio-lyrics-head">
            <div className="studio-lyrics-stats">
              <span className="studio-lyrics-stat-chip highlight">
                {lyricsBlocks.length} {lyricsBlocks.length === 1 ? 'SECTION' : 'SECTIONS'}
              </span>
              <span className="studio-lyrics-stat-chip">
                {lyricsBlocks.reduce((acc, b) => acc + b.tags.length, 0)} TAGS
              </span>
              <span className="studio-lyrics-stat-chip">
                {lyricsMode === 'raw'
                  ? `${lyricsRawText.trim().split(/\s+/).filter(Boolean).length} WORDS`
                  : `${lyricsBlocks.reduce((acc, b) => acc + b.text.trim().split(/\s+/).filter(Boolean).length, 0)} WORDS`}
              </span>
            </div>

            <div className="studio-lyrics-mode-switch">
              <button
                type="button"
                className={`studio-lyrics-mode-btn ${lyricsMode === 'canvas' ? 'active' : ''}`}
                onClick={() => handleSwitchLyricsMode('canvas')}
              >
                CANVAS
              </button>
              <button
                type="button"
                className={`studio-lyrics-mode-btn ${lyricsMode === 'raw' ? 'active' : ''}`}
                onClick={() => handleSwitchLyricsMode('raw')}
              >
                RAW [TAGS]
              </button>
            </div>
          </div>

          {lyricsMode === 'canvas' ? (
            <>
              {/* Quick Tag Palette Bar */}
              <div className="studio-lyrics-palette">
                <div className="studio-lyrics-palette-tabs">
                  <span className="studio-field-label studio-field-label-compact">
                    TAG PALETTE:
                  </span>
                  {(['all', 'structure', 'intensity', 'solo', 'vocal'] as const).map((cat) => {
                    const isSelected = lyricsPaletteCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        className={`studio-lyrics-cat-tab ${cat} ${isSelected ? 'active' : ''}`}
                        onClick={() => handleTogglePaletteCategory(cat)}
                        title={
                          isSelected
                            ? 'Click to collapse sub-tags'
                            : `Click to reveal ${cat === 'all' ? 'ALL' : CATEGORY_METADATA[cat].label} tags`
                        }
                      >
                        <span>{cat === 'all' ? 'ALL' : CATEGORY_METADATA[cat].label}</span>
                        <span className="studio-lyrics-cat-arrow">{isSelected ? '▲' : '▼'}</span>
                      </button>
                    );
                  })}
                </div>

                {lyricsPaletteCategory !== null && (
                  <div className="studio-lyrics-palette-chips">
                    {STRUCTURED_TAGS.filter(
                      (t) => lyricsPaletteCategory === 'all' || t.category === lyricsPaletteCategory
                    ).map((tag) => (
                      <button
                        key={tag.token}
                        type="button"
                        className={`studio-lyrics-chip ${tag.category}`}
                        onClick={() => handleInsertSection(lyricsBlocks.length, tag.token)}
                        title={tag.description}
                      >
                        <span>{tag.token}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Scrollable Canvas */}
              <div className="studio-lyrics-canvas">
                {/* Top Separator for inserting before first section */}
                <div className="studio-lyrics-separator">
                  <button
                    type="button"
                    className="studio-lyrics-add-sep-btn"
                    onClick={() => setInsertingSepIndex(insertingSepIndex === -1 ? null : -1)}
                    title="Insert section at start"
                  >
                    <span className="studio-lyrics-add-plus">+</span>
                    <span>ADD SECTION</span>
                  </button>
                </div>

                {insertingSepIndex === -1 && (
                  <div className="studio-lyrics-tray">
                    <div className="studio-lyrics-tray-head">
                      <span className="studio-lyrics-tray-title">SELECT STRUCTURED TAG TO INSERT AT START</span>
                      <button
                        type="button"
                        className="studio-lang-search-clear"
                        onClick={() => setInsertingSepIndex(null)}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="studio-lyrics-tray-grid">
                      {STRUCTURED_TAGS.map((tag) => (
                        <button
                          key={tag.token}
                          type="button"
                          className={`studio-lyrics-tray-card ${tag.category}`}
                          onClick={() => handleInsertSection(0, tag.token)}
                        >
                          <span className="studio-lyrics-tray-token">{tag.token}</span>
                          <span className="studio-lyrics-tray-desc">{tag.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Blocks List */}
                {lyricsBlocks.map((block, index) => {
                  const primaryTag = block.tags[0];
                  const primaryCategory = primaryTag ? getTagCategory(primaryTag) : 'structure';

                  return (
                    <React.Fragment key={block.id}>
                      <div className={`studio-lyrics-block ${primaryCategory}`}>
                        <div className="studio-lyrics-block-header">
                          <div className="studio-lyrics-block-header-left">
                            <span className="studio-lyrics-block-idx">
                              {String(index + 1).padStart(2, '0')}
                            </span>

                            <div className="studio-lyrics-badges-wrap">
                              {block.tags.map((tag, tIdx) => {
                                const cat = getTagCategory(tag);
                                return (
                                  <span
                                    key={`${tag}-${tIdx}`}
                                    className={`studio-lyrics-badge ${cat}`}
                                    title={getTagDescription(tag)}
                                  >
                                    <span>{tag}</span>
                                    <button
                                      type="button"
                                      className="studio-lyrics-badge-close"
                                      onClick={() => handleRemoveTag(block.id, tIdx)}
                                      title="Remove tag"
                                    >
                                      ✕
                                    </button>
                                  </span>
                                );
                              })}

                              <button
                                type="button"
                                className="studio-lyrics-add-tag-btn"
                                onClick={() =>
                                  setAddingTagBlockId(addingTagBlockId === block.id ? null : block.id)
                                }
                                title="Add structured tag to this section"
                              >
                                + TAG
                              </button>
                            </div>
                          </div>

                          <div className="studio-lyrics-block-actions">
                            <button
                              type="button"
                              className="studio-lyrics-icon-btn"
                              disabled={index === 0}
                              onClick={() => handleMoveBlock(index, 'up')}
                              title="Move section up"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              className="studio-lyrics-icon-btn"
                              disabled={index === lyricsBlocks.length - 1}
                              onClick={() => handleMoveBlock(index, 'down')}
                              title="Move section down"
                            >
                              ▼
                            </button>
                            <button
                              type="button"
                              className="studio-lyrics-icon-btn danger"
                              onClick={() => handleDeleteBlock(index)}
                              title="Delete section"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {/* Dropdown tray for adding tags to this block */}
                        {addingTagBlockId === block.id && (
                          <div className="studio-lyrics-tray">
                            <div className="studio-lyrics-tray-head">
                              <span className="studio-lyrics-tray-title">
                                APPEND STRUCTURED TAG TO SECTION {index + 1}
                              </span>
                              <button
                                type="button"
                                className="studio-lang-search-clear"
                                onClick={() => setAddingTagBlockId(null)}
                              >
                                ✕
                              </button>
                            </div>
                            <div className="studio-lyrics-tray-grid">
                              {STRUCTURED_TAGS.map((tag) => (
                                <button
                                  key={tag.token}
                                  type="button"
                                  className={`studio-lyrics-tray-card ${tag.category}`}
                                  onClick={() => handleAddTagToBlock(block.id, tag.token)}
                                >
                                  <span className="studio-lyrics-tray-token">{tag.token}</span>
                                  <span className="studio-lyrics-tray-desc">{tag.description}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <textarea
                          className="studio-lyrics-block-textarea"
                          placeholder={
                            block.tags.some((t) =>
                              [
                                '[Instrumental]',
                                '[inst]',
                                '[Guitar Solo]',
                                '[Piano Interlude]',
                                '[Drum Break]',
                                '[Silence]',
                              ].includes(t)
                            )
                              ? '(Instrumental section — no vocal synthesis required)'
                              : 'Type lyrics for this section...'
                          }
                          value={block.text}
                          onChange={(e) => handleUpdateBlockText(block.id, e.target.value)}
                        />
                      </div>

                      {/* + Separator Between Blocks */}
                      <div className="studio-lyrics-separator">
                        <button
                          type="button"
                          className="studio-lyrics-add-sep-btn"
                          onClick={() =>
                            setInsertingSepIndex(insertingSepIndex === index ? null : index)
                          }
                          title="Split and add a new section"
                        >
                          <span className="studio-lyrics-add-plus">+</span>
                          <span>ADD SECTION</span>
                        </button>
                      </div>

                      {insertingSepIndex === index && (
                        <div className="studio-lyrics-tray">
                          <div className="studio-lyrics-tray-head">
                            <span className="studio-lyrics-tray-title">
                              SELECT STRUCTURED TAG FOR NEW SECTION
                            </span>
                            <button
                              type="button"
                              className="studio-lang-search-clear"
                              onClick={() => setInsertingSepIndex(null)}
                            >
                              ✕
                            </button>
                          </div>
                          <div className="studio-lyrics-tray-grid">
                            {STRUCTURED_TAGS.map((tag) => (
                              <button
                                key={tag.token}
                                type="button"
                                className={`studio-lyrics-tray-card ${tag.category}`}
                                onClick={() => handleInsertSection(index + 1, tag.token)}
                              >
                                <span className="studio-lyrics-tray-token">{tag.token}</span>
                                <span className="studio-lyrics-tray-desc">{tag.description}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="studio-lyrics-raw-wrap">
              <div className="studio-lyrics-raw-hint">
                ACESTEP SQUARED-BRACKET SYNTAX — EDIT DIRECTLY OR PASTE FULL SONG:
              </div>
              <textarea
                className="studio-lyrics-raw-textarea"
                value={lyricsRawText}
                onChange={(e) => setLyricsRawText(e.target.value)}
                placeholder="[Intro]&#10;Atmospheric chords...&#10;&#10;[Verse 1]&#10;[whispered]&#10;Neon light flickering...&#10;&#10;[Chorus]&#10;Energy release..."
                autoFocus
              />
            </div>
          )}

          {/* Modal Actions Footer */}
          <div className="studio-param-actions-row studio-lyrics-modal-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLyricsBlocks([createBlock(['[Intro]'], '')]);
                setLyricsRawText('');
              }}
            >
              CLEAR CANVAS
            </Button>
            <div className="studio-lyrics-modal-actions-right">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveModal(null)}
              >
                CANCEL
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleApplyLyrics}
              >
                DONE
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Cover Art Expand Modal */}
      <Modal
        isOpen={activeModal === 'cover' && Boolean(coverUrl)}
        onClose={() => setActiveModal(null)}
        title={title.trim() || 'COVER ART'}
        size="sm"
      >
        {coverUrl && (
          <img
            src={coverUrl}
            alt={title.trim() || 'Cover art'}
            className="studio-cover-expanded-img"
          />
        )}
      </Modal>
    </div>
  );
};
