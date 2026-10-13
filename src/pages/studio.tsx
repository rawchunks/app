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
import { Mic2, UploadCloud, FileAudio } from 'lucide-react';
import { useOptions } from '@/hooks/use-options';
import { useVoices, voiceAvailability, voiceReady, voiceStatus } from '@/hooks/use-voices';
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
  style?: React.CSSProperties;
}

const TAGS = [
  'ACID TECHNO',
  '140 BPM',
  'TB-303',
  'INDUSTRIAL',
  'CYBERPUNK',
  'DARK AMBIENT',
  'DISTORTED 808',
  'BREAKCORE',
  'SYNTHWAVE',
  'NEURAL GLITCH',
];

const POPULAR_LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Spanish' },
  { id: 'ja', label: 'Japanese' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'zh', label: 'Chinese' },
  { id: 'ko', label: 'Korean' },
  { id: 'it', label: 'Italian' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'ru', label: 'Russian' },
  { id: 'ar', label: 'Arabic' },
  { id: 'hi', label: 'Hindi' },
];

const DEFAULT_LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Spanish' },
  { id: 'ja', label: 'Japanese' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'zh', label: 'Chinese' },
  { id: 'ko', label: 'Korean' },
  { id: 'it', label: 'Italian' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'ru', label: 'Russian' },
  { id: 'ar', label: 'Arabic' },
  { id: 'hi', label: 'Hindi' },
  { id: 'nl', label: 'Dutch' },
  { id: 'pl', label: 'Polish' },
  { id: 'tr', label: 'Turkish' },
  { id: 'sv', label: 'Swedish' },
  { id: 'da', label: 'Danish' },
  { id: 'fi', label: 'Finnish' },
  { id: 'no', label: 'Norwegian' },
  { id: 'id', label: 'Indonesian' },
  { id: 'vi', label: 'Vietnamese' },
  { id: 'th', label: 'Thai' },
  { id: 'el', label: 'Greek' },
  { id: 'cs', label: 'Czech' },
  { id: 'ro', label: 'Romanian' },
  { id: 'hu', label: 'Hungarian' },
  { id: 'uk', label: 'Ukrainian' },
  { id: 'he', label: 'Hebrew' },
  { id: 'ca', label: 'Catalan' },
  { id: 'hr', label: 'Croatian' },
  { id: 'sk', label: 'Slovak' },
  { id: 'bg', label: 'Bulgarian' },
  { id: 'sr', label: 'Serbian' },
  { id: 'lt', label: 'Lithuanian' },
  { id: 'ms', label: 'Malay' },
  { id: 'tl', label: 'Filipino' },
  { id: 'fa', label: 'Persian' },
  { id: 'ur', label: 'Urdu' },
  { id: 'bn', label: 'Bangla' },
  { id: 'ta', label: 'Tamil' },
  { id: 'te', label: 'Telugu' },
  { id: 'pa', label: 'Punjabi' },
  { id: 'ne', label: 'Nepali' },
  { id: 'sw', label: 'Swahili' },
  { id: 'az', label: 'Azerbaijani' },
  { id: 'is', label: 'Icelandic' },
  { id: 'ht', label: 'Haitian Creole' },
  { id: 'la', label: 'Latin' },
  { id: 'sa', label: 'Sanskrit' },
  { id: 'yue', label: 'Cantonese' },
];

export const Studio: React.FC<Props> = ({ onEditSong, className = '', style = {} }) => {
  const [state, setState] = useState<State>(store.getState());
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [instrumental, setInstrumental] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [languageSearch, setLanguageSearch] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [model, setModel] = useState('turbo');
  const options = useOptions();
  const generation = options.data?.generation;
  const availableLanguages = generation?.languages && generation.languages.length > 0 ? generation.languages : DEFAULT_LANGUAGES;
  const filteredLanguages = availableLanguages.filter(
    (l) =>
      l.id.toLowerCase().includes(languageSearch.toLowerCase()) ||
      l.label.toLowerCase().includes(languageSearch.toLowerCase())
  );
  useEffect(() => { if (generation && !generation.modes.some(mode => mode.id === model)) setModel(generation.modes[0].id); }, [generation, model]);
  const [useVoice, setUseVoice] = useState(false);
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const currentVoiceFile = useRef<File | null>(null);
  const [voiceMode, setVoiceMode] = useState<'reference' | 'trained'>('reference');
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [voiceTab, setVoiceTab] = useState<'saved' | 'upload'>('saved');
  const [isDraggingVoice, setIsDraggingVoice] = useState(false);
  const uploadedVoice = useRef<{ file: File; creator: string; id: string } | null>(null);
  const [uploadedVoiceId, setUploadedVoiceId] = useState<string | null>(null);
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

  // Selectable parameters modal state
  const [activeModal, setActiveModal] = useState<'duration' | 'bpm' | 'key' | 'voice' | 'language' | 'lyrics' | null>(null);
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
  const { session } = useSession();
  const { voices, loading: loadingVoices, error: voicesError, refresh: refreshVoices, remember: rememberVoice } = useVoices(readAddress);
  const voiceOutput = model === 'sft' ? 'sft' : 'turbo';
  const selectedVoice = voices.find(voice => voice.id === selectedVoiceId);
  const attachedVoice = voices.find(voice => voice.id === uploadedVoiceId);
  const canUseVoice = voiceMode === 'reference' ? Boolean(voiceFile) : Boolean(selectedVoice && voiceReady(selectedVoice, voiceOutput));
  const voiceName = voiceMode === 'reference' ? voiceFile?.name : selectedVoice?.name;
  useEffect(() => { scopeRef.current++; return () => { scopeRef.current++; streamRef.current?.abort(); store.setGenerating(false); }; }, [userAddr]);
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
    if (!prompt.trim()) {
      toast.error('Enter a prompt first to generate cover');
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
          prompt: prompt.trim(),
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

  const handleGenerate = () => {
    if (state.isGenerating || isGeneratingCover || !prompt.trim()) return;

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
      style={style}
    >
      {/* Mobile Pocket Tab Switcher */}
      {state.tracks.length > 0 && <div className="studio-pocket-bar">
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
      </div>}

      {/* Control Configuration Panel */}
      <div className="studio-panel-config panel">
        <div className="studio-panel-header">
          <Glitch text="STUDIO_CREATE" />
          <Badge variant={model === 'turbo' ? 'primary' : 'secondary'}>
            {model === 'turbo' ? 'FAST' : 'STUDIO MASTER'}
          </Badge>
        </div>

        <div className="studio-engine-switcher">
          {generation?.modes.slice().sort((a, b) => Number(b.id === 'turbo') - Number(a.id === 'turbo')).map(mode => <Button key={mode.id} variant={model === mode.id ? (mode.id === 'turbo' ? 'primary' : 'secondary') : 'ghost'} size="sm" onClick={() => setModel(mode.id)}>{mode.id === 'turbo' ? 'FAST' : 'STUDIO MASTER'}</Button>)}
          {options.error && <span role="alert">{options.error.message}</span>}
        </div>

        {/* Self-Contained Accordion (Strictly ONE open at a time) */}
        <div className="studio-accordion">
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
                      style={{ display: 'none' }}
                      onChange={handleCoverFileUpload}
                    />
                    {coverUrl ? (
                      <>
                        <img
                          src={coverUrl}
                          alt="Cover preview"
                          className="studio-avatar-preview"
                          onClick={() => coverFileInputRef.current?.click()}
                        />
                        <button
                          type="button"
                          className="studio-avatar-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCoverUrl(null);
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
                          disabled={isGeneratingCover || !prompt.trim()}
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
                          disabled={isGeneratingCover || !prompt.trim()}
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
                <div className="studio-field-group">
                  <label className="studio-field-label">
                    <span>PROMPT</span>
                    <span className="studio-field-optional">REQUIRED</span>
                  </label>
                  <textarea
                    className="cyber-input-field"
                    placeholder="Describe style, rhythm, soundscapes, instruments..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </div>

                {/* Lyrics Input */}
                <div className="studio-field-group">
                  <div className="studio-lyrics-row">
                    <label className="studio-field-label" style={{ margin: 0 }}>
                      <span>LYRICS</span>
                      <span className="studio-field-optional">(OPTIONAL)</span>
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
                    {TAGS.map((t) => {
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
        </div>

        {/* Generate Button in Native Rawchunks Button */}
        <div className="studio-main-action-wrap">
          <Button
            variant="primary"
            size="lg"
            disabled={state.isGenerating || isGeneratingCover || !prompt.trim() || !generation || !model}
            onClick={handleGenerate}
            className="studio-generate-btn"
          >
            {state.isGenerating ? 'SYNTHESIZING...' : 'GENERATE AUDIO'}
          </Button>
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
                      <Button
                        variant={isPlayingThis ? 'primary' : 'ghost'}
                        size="sm"
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
                        {isPlayingThis ? 'PAUSE' : 'PLAY'}
                      </Button>
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
                          {onEditSong && <Button variant="ghost" size="xs" onClick={() => onEditSong(t.song)}>EDIT</Button>}
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => handleSaveVoice(t)}
                          >
                            SAVE VOICE
                          </Button>
                          <Button
                            variant={t.song.public ? 'secondary' : 'ghost'}
                            size="xs"
                            disabled={Boolean(publicPending)}
                            onClick={() => togglePublic(t.song)}
                          >
                            {t.song.public ? 'MAKE PRIVATE' : 'MAKE PUBLIC'}
                          </Button>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
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
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
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
        title="SELECT AUDIO DURATION"
      >
        <div className="studio-param-modal-content">
          <div className="studio-param-presets-grid">
            {[30, 60, 90, 120, 180, 240, 300].map((sec) => (
              <Button
                key={sec}
                variant={audioDurationSeconds === sec ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setAudioDurationSeconds(sec)}
              >
                {sec}s ({sec / 60 >= 1 ? `${sec / 60}m` : `${sec}s`})
              </Button>
            ))}
          </div>

          <div className="studio-param-slider-wrap">
            <div className="studio-field-label">
              <span>CUSTOM DURATION</span>
              <span className="studio-highlight">{audioDurationSeconds ? `${audioDurationSeconds} SECONDS` : '120s (DEFAULT)'}</span>
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
              RESET TO DEFAULT
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
        title="SELECT TEMPO (BPM)"
      >
        <div className="studio-param-modal-content">
          <div className="studio-param-presets-grid">
            {[
              { val: 80, label: '80 (DOWNTEMPO)' },
              { val: 110, label: '110 (MIDTEMPO)' },
              { val: 128, label: '128 (HOUSE)' },
              { val: 140, label: '140 (TECHNO)' },
              { val: 160, label: '160 (HARDCORE)' },
              { val: 174, label: '174 (D&B)' },
            ].map((p) => (
              <Button
                key={p.val}
                variant={bpm === p.val ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setBpm(p.val)}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <div className="studio-param-slider-wrap">
            <div className="studio-field-label">
              <span>EXACT TEMPO</span>
              <span className="studio-highlight">{bpm ? `${bpm} BPM` : 'AUTO (FROM PROMPT)'}</span>
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
              AUTO (NONE)
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
        title="SELECT KEY & SCALE"
      >
        <div className="studio-param-modal-content">
          <div className="studio-field-label">ROOT NOTE</div>
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

          <div className="studio-field-label" style={{ marginTop: '8px' }}>SCALE MODE</div>
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
              <span>TARGET KEY</span>
              <span className="studio-highlight">{keyScale ? keyScale.toUpperCase() : 'AUTO (DETECT FROM PROMPT)'}</span>
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
              AUTO / CLEAR
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
        title="CUSTOM VOCAL"
        maxWidth="560px"
      >
        <div className="studio-param-modal-content">
          <input
            type="file"
            ref={voiceFileInputRef}
            accept="audio/*"
            style={{ display: 'none' }}
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
              <span>SAVED VOICES</span>
              <span className="studio-voice-count-badge">{voices.length}</span>
            </button>
            <button
              type="button"
              className={`studio-voice-mode-btn ${voiceTab === 'upload' ? 'active' : ''}`}
              onClick={() => setVoiceTab('upload')}
            >
              <UploadCloud size={13} />
              <span>UPLOAD SAMPLE</span>
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
                  <span className="studio-voice-status-title">LOADING SAVED VOICES...</span>
                </div>
              )}

              {!loadingVoices && !voicesError && !readAddress && (
                <div className="studio-voice-status-box">
                  <span className="studio-voice-status-title">WALLET NOT CONNECTED</span>
                  <span className="studio-voice-status-desc">Connect your wallet to access your saved custom vocal profiles.</span>
                </div>
              )}

              {!loadingVoices && !voicesError && readAddress && voices.length === 0 && (
                <div className="studio-voice-empty-state">
                  <Mic2 size={24} className="studio-voice-empty-icon" />
                  <span className="studio-voice-empty-title">NO SAVED VOICES YET</span>
                  <span className="studio-voice-empty-desc">
                    Upload an audio sample to use as a vocal reference, or save a vocal profile from one of your generated songs.
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setVoiceTab('upload')}
                  >
                    UPLOAD VOCAL SAMPLE
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
                            <Badge variant={voice.status === 'ready' ? 'secondary' : voice.status === 'error' ? 'warning' : 'default'}>
                              {voiceStatus(voice).toUpperCase()}
                            </Badge>
                            {isSelected && <span className="studio-voice-card-check">✓</span>}
                          </div>
                        </div>

                        <div className="studio-voice-availability" role="status">
                          <span>Fast: {voiceAvailability(voice, 'turbo')}</span>
                          <span>Master: {voiceAvailability(voice, 'sft')}</span>
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
                  CLICK OR DRAG AUDIO TO UPLOAD VOCAL SAMPLE
                </span>
                <span className="studio-voice-upload-sub">
                  WAV, MP3, FLAC, OGG, WebM (isolated vocals recommended)
                </span>
              </div>

              {voiceMode === 'reference' && voiceFile && (
                <div className="studio-voice-file-card">
                  <div className="studio-voice-file-info">
                    <FileAudio size={18} className="studio-voice-file-icon" />
                    <div className="studio-voice-file-meta">
                      <span className="studio-voice-file-name">{voiceFile.name}</span>
                      <span className="studio-voice-file-size">
                        {(voiceFile.size / 1024 / 1024).toFixed(2)} MB · REFERENCE SAMPLE
                        {attachedVoice && ` · Fast: ${voiceAvailability(attachedVoice, 'turbo')} · Master: ${voiceAvailability(attachedVoice, 'sft')}`}
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
            <div className="studio-field-label" style={{ margin: 0 }}>
              <span>ACTIVE VOCAL SELECTION</span>
              <span className="studio-highlight">
                {voiceMode === 'reference' && voiceFile
                  ? `SAMPLE: ${voiceFile.name}`
                  : voiceMode === 'trained' && selectedVoice
                  ? `PROFILE: ${selectedVoice.name.toUpperCase()}`
                  : 'NONE (DEFAULT INSTRUMENTAL / VOCAL)'}
              </span>
            </div>
          </div>

          {/* Clone Strength / Vocal Resemblance Slider */}
          {(voiceFile || selectedVoice) && (
            <div className="studio-param-slider-wrap">
              <div className="studio-field-label">
                <span>VOCAL RESEMBLANCE</span>
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
                <span>CREATIVE FREEDOM</span>
                <span>EXACT TIMBRE MATCH</span>
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
                REMOVE VOICE
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
      <Modal
        isOpen={activeModal === 'language'}
        onClose={() => setActiveModal(null)}
        title="SELECT VOCAL LANGUAGE"
      >
        <div className="studio-param-modal-content" style={{ gap: '10px' }}>
          <div className="studio-lang-search-wrap">
            <span className="studio-lang-search-icon">🔍</span>
            <input
              type="text"
              placeholder="SEARCH 49 LANGUAGES (E.G. JAPANESE, ES, GERMAN)..."
              value={languageSearch}
              onChange={(e) => setLanguageSearch(e.target.value)}
              className="cyber-input-field studio-lang-search-input"
              autoFocus
            />
            {languageSearch && (
              <button
                type="button"
                className="studio-lang-search-clear"
                onClick={() => setLanguageSearch('')}
              >
                ✕
              </button>
            )}
          </div>

          <div className="studio-lang-scroll-body">
            {!languageSearch && (
              <>
                <div className="studio-lang-section-title">POPULAR LANGUAGES</div>
                <div className="studio-lang-chips-row">
                  {POPULAR_LANGUAGES.map((lang) => {
                    const isSelected = selectedLanguage === lang.id;
                    return (
                      <button
                        key={lang.id}
                        type="button"
                        className={`studio-lang-chip ${isSelected ? 'active' : ''}`}
                        onClick={() => setSelectedLanguage(lang.id)}
                      >
                        <span className="studio-lang-chip-code">{lang.id.toUpperCase()}</span>
                        <span className="studio-lang-chip-label">{lang.label}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="studio-lang-section-title">
              {languageSearch
                ? `MATCHING LANGUAGES (${filteredLanguages.length})`
                : `ALL LANGUAGES (${availableLanguages.length})`}
            </div>

            <div className="studio-lang-grid">
              {filteredLanguages.map((lang) => {
                const isSelected = selectedLanguage === lang.id;
                return (
                  <button
                    key={lang.id}
                    type="button"
                    className={`studio-lang-card ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedLanguage(lang.id)}
                  >
                    <span className="studio-lang-badge">{lang.id.toUpperCase()}</span>
                    <span className="studio-lang-name">{lang.label}</span>
                    {isSelected && <span className="studio-lang-check">✓</span>}
                  </button>
                );
              })}
            </div>

            {filteredLanguages.length === 0 && (
              <div className="studio-lang-empty">NO LANGUAGES FOUND MATCHING "{languageSearch.toUpperCase()}"</div>
            )}
          </div>

          <div className="studio-lang-selected-strip">
            <div className="studio-field-label" style={{ margin: 0 }}>
              <span>TARGET VOCAL LANGUAGE</span>
              <span className="studio-highlight">
                {selectedLanguage
                  ? `${selectedLanguage.toUpperCase()} — ${(availableLanguages.find((l) => l.id === selectedLanguage)?.label || selectedLanguage).toUpperCase()}`
                  : 'AUTO (DETECT FROM LYRICS / PROMPT)'}
              </span>
            </div>
          </div>

          <div className="studio-param-actions-row" style={{ marginTop: '2px', paddingTop: '8px' }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedLanguage(null);
                setActiveModal(null);
              }}
            >
              RESET TO AUTO
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

      {/* 6. Structured Lyrics Canvas Modal */}
      <Modal
        isOpen={activeModal === 'lyrics'}
        onClose={() => setActiveModal(null)}
        title="LYRICS CANVAS"
        maxWidth="840px"
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
                  <span className="studio-field-label" style={{ margin: 0, fontSize: '10px' }}>
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
          <div className="studio-param-actions-row" style={{ marginTop: '4px', paddingTop: '8px' }}>
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
            <div style={{ display: 'flex', gap: '8px' }}>
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
    </div>
  );
};
