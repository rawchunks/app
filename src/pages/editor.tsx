import { sdk } from '@/lib/sdk';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Glitch } from '../components/glitch';
import { Button } from '../components/button';
import { Badge } from '../components/badge';
import { Song, Task } from '../lib/schema';
import { useDawStore, TrackType, type Take } from '../lib/daw/store';
import { dawEngine } from '../lib/daw/engine';
import { useOptions } from '../hooks/use-options';
import { useSelectedUserAddress } from '../hooks/use-address';
import { Board } from '../components/daw/Board';
import { Toolbox, ActiveTool } from '../components/daw/Toolbox';
import { Tooltip } from '../components/daw/Tooltip';
import { GitCommit } from 'lucide-react';
import { source, sourceInterval } from '../lib/daw/takes';
import { readProject, writeProject } from '../lib/cache';
import { useQueryClient } from '@tanstack/react-query';

export interface Props {
  song: Song;
  onBack: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Editor: React.FC<Props> = ({ song, onBack, className = '', style = {} }) => {
  const {
    tracks,
    isPlaying,
    duration,
    bpm,
    loop,
    selection,
    legoContextTrackIds,
    takes,
    selectedTrackId,
    initProject,
    setPlaying,
    setPlayhead,
    setLoop,
    setSelection,
    setSelectedTrackId,
    addTrack,
    addClip,
    setTakes,
    setCommits,
    syncStems,
    restoreSession,
  } = useDawStore();

  // Connected wallet address
  const { userAddress, readAddress } = useSelectedUserAddress();
  const effectiveAddress = userAddress;
  const queryClient = useQueryClient();

  // Active Toolbox View (Supports deep-linking via ?tab=mixer, etc.)
  const [activeTool, setActiveTool] = useState<ActiveTool>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p && ['studio', 'mixer', 'keys', 'drums', 'strudel', 'dsp', 'sample', 'history'].includes(p)) {
        return p as ActiveTool;
      }
    }
    return 'studio';
  });

  // AI Generation & Studio Parameters
  const [task, setTask] = useState<Task>('repaint');
  const [selectedQuality, setSelectedQuality] = useState<string>('');
  const [prompt, setPrompt] = useState<string>('');
  const [lyrics, setLyrics] = useState<string>('');
  const [stemType, setStemType] = useState<string>('all');
  const [coverStrength, setCoverStrength] = useState<number>(0.65);
  const [repaintMode, setRepaintMode] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [repaintStrength, setRepaintStrength] = useState<number>(0.75);
  const [instrument, setInstrument] = useState('');
  const [targetDuration, setTargetDuration] = useState<number>(duration > 0 ? duration + 30 : 60);

  const options = useOptions();
  const editing = options.data?.editing;
  const [parameters, setParameters] = useState<Record<string, string | number>>({});
  useEffect(() => {
    const action = editing?.tasks.find(action => action.id === task);
    if (action?.modes.length && !action.modes.includes(selectedQuality)) setSelectedQuality(action.modes[0]);
  }, [editing, task, selectedQuality]);

  // Commit Modal
  const [isCommitModalOpen, setIsCommitModalOpen] = useState<boolean>(false);
  const [commitMessage, setCommitMessage] = useState<string>('');

  // Processing & Poller
  const [processing, setProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [toolboxRevision, setToolboxRevision] = useState(0);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scopeRef = useRef(0);
  const sessionRef = useRef(false);
  useEffect(() => {
    scopeRef.current++;
    setProcessing(false);
    const leave = () => { scopeRef.current++; if (pollTimerRef.current) clearTimeout(pollTimerRef.current); };
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); leave(); };
  }, [song.id, readAddress]);

  // Fetch real takes, commits, and multitrack stems from API
  const loadSongData = useCallback(async () => {
    if (!readAddress) return;
    const scope = scopeRef.current;
    try {
      const history = await queryClient.fetchQuery({
        queryKey: ['history', song.id, readAddress], staleTime: 0,
        queryFn: async () => {
          const response = await sdk.fetch(`/api/editing/history/${song.id}`, { userAddress: readAddress });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Could not load song history');
          return result;
        },
      });
      if (scope !== scopeRef.current || useDawStore.getState().songId !== song.id) return;
      setTakes(history.takes);
      setCommits(history.commits);
      const completed = new Set(history.takes.map((take: Take) => take.provenance?.taskId).filter(Boolean));
      useDawStore.setState(state => ({ operations: state.operations.filter(operation => !completed.has(operation.id)) }));
      if (!sessionRef.current) { restoreSession(history.commits); sessionRef.current = true; }
      syncStems(history.stems);
      const state = useDawStore.getState();
      writeProject({ song: { ...song, url: state.tracks.find(track => track.id === 'master')?.clips[0]?.url ?? song.url, duration: state.duration }, ...history, session: { tracks: state.tracks, originals: state.originals, operations: state.operations, bpm: state.bpm } }, readAddress);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load song history');
    }
  }, [song, readAddress, setTakes, setCommits, syncStems, restoreSession, queryClient]);

  // Initialize DAW Engine and Project Store on Mount
  useEffect(() => {
    let active = true;
    dawEngine.resetProject();
    const initialDur = typeof song.duration === 'number' && song.duration > 0 ? song.duration : 60;
    const cached = readAddress ? readProject(song.id, readAddress) : null;
    sessionRef.current = Boolean(cached?.session || cached?.commits.some(commit => Array.isArray(commit.timeline_snapshot?.tracks)));
    initProject(song.id, song.title, initialDur, song.url, cached ?? undefined);

    dawEngine.init().then(() => {
      if (!active || useDawStore.getState().songId !== song.id) return;
      const master = useDawStore.getState().tracks.find(track => track.id === 'master')?.clips[0];
      if (master) void dawEngine.loadClip('master', master.id, master.url, master.startTime, master.offset, master.duration);
    });

    dawEngine.setTimeCallback((seconds) => {
      setPlayhead(seconds);
    });

    return () => {
      active = false;
      dawEngine.resetProject();
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [song.id, song.url, readAddress, initProject, setPlayhead]);

  useEffect(() => { void loadSongData(); }, [loadSongData]);

  useEffect(() => {
    for (const track of tracks) dawEngine.scheduleTrack(track);
  }, [tracks]);

  // Master Transport Controls
  const handleTogglePlay = async () => {
    if (isPlaying) {
      dawEngine.pauseTransport();
      setPlaying(false);
    } else {
      try { await dawEngine.startTransport(); }
      catch (error) { toast.error(error instanceof Error ? error.message : 'Could not play the arrangement'); }
    }
  };

  const handleReturnToZero = () => {
    dawEngine.seek(0);
    setPlayhead(0);
  };

  const handleToggleLoop = () => {
    const nextLoop = !loop;
    setLoop(nextLoop);
    if (selection) {
      dawEngine.setLoop(nextLoop, selection.start, selection.end);
    } else {
      dawEngine.setLoop(nextLoop, 0, duration > 0 ? duration : 60);
    }
  };

  const handleAuditionSelection = () => {
    if (selection) {
      void dawEngine.auditionSection(selection.start, selection.end, false).catch(error => toast.error(error instanceof Error ? error.message : 'Could not play the section'));
    }
  };

  // Global Keyboard Shortcuts (Space, Shift+Space, L, 0)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.shiftKey) {
          handleAuditionSelection();
        } else {
          handleTogglePlay();
        }
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        handleToggleLoop();
      } else if (e.key === 'Home' || e.key === '0') {
        e.preventDefault();
        handleReturnToZero();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, loop, selection, selectedTrackId, takes]);

  // Track Creation
  const handleAddTrack = (type: TrackType) => {
    const newTrack = addTrack(type);

    if (type === 'sample' && song.url) {
      addClip(newTrack.id, {
        id: `clip-${Date.now()}`,
        name: `${song.title} (Track Clip)`,
        url: song.url,
        startTime: 0,
        duration: duration > 0 ? duration : 60,
        offset: 0,
      });
    }

    setSelectedTrackId(newTrack.id);
    if (type === 'pianoroll') setActiveTool('keys');
    if (type === 'sequencer') setActiveTool('drums');
    if (type === 'strudel') setActiveTool('strudel');
  };

  // Commit Snapshot
  const handleCreateCommit = async () => {
    if (!commitMessage.trim()) {
      toast.error('Please enter a commit message');
      return;
    }
    if (!effectiveAddress) {
      toast.error('Wallet connection required to commit snapshots');
      return;
    }
    try {
      const res = await sdk.fetch('/api/editing/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songId: song.id,
          userAddress: effectiveAddress,
          message: commitMessage,
          snapshot: { tracks, bpm, duration, originals: useDawStore.getState().originals },
        }),
      });

      if (!res.ok) throw new Error('Failed to create commit');
      toast.success('Project snapshot committed to studio timeline!');
      setIsCommitModalOpen(false);
      setCommitMessage('');
      await loadSongData();
    } catch (err: any) {
      toast.error(err.message || 'Commit snapshot failed');
    }
  };

  const showResult = async (data: { take?: Take }) => {
    if (data.take) useDawStore.getState().upsertTake(data.take);
    await loadSongData();
    if (data.take) {
      setSelectedTrackId(data.take.id);
      if (data.take.provenance?.region) setSelection(data.take.provenance.region);
      toast.success('Section ready');
    } else toast.success('Tracks ready');
  };

  const pollTask = (job: { taskId: string; task: Task; stemId?: string }, address: string) => {
    const scope = scopeRef.current;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    const query = new URLSearchParams({ songId: song.id, task: job.task, userAddress: address });
    if (job.stemId) query.set('stemId', job.stemId);
    const poll = async () => {
      try {
        const response = await sdk.fetch(`/api/editing/status/${encodeURIComponent(job.taskId)}?${query}`, { userAddress: address });
        const data = await response.json();
        if (scope !== scopeRef.current) return;
        if (!response.ok || data.status === 'error') throw new Error(data.error || 'Audio processing failed');
        setProgress(data.progress);
        useDawStore.setState(state => ({ operations: state.operations.map(item => item.id === job.taskId ? { ...item, status: data.status, progress: data.progress } : item) }));
        if (data.status === 'ready') { setProcessing(false); setProgress(100); await showResult(data); useDawStore.setState(state => ({ operations: state.operations.filter(item => item.id !== job.taskId) })); }
        else pollTimerRef.current = setTimeout(poll, 2000);
      } catch (error) { if (scope !== scopeRef.current) return; setProcessing(false); const message = error instanceof Error ? error.message : 'Failed to check audio status'; useDawStore.setState(state => ({ operations: state.operations.map(item => item.id === job.taskId ? { ...item, status: 'error', error: message } : item) })); toast.error(message); }
    };
    pollTimerRef.current = setTimeout(poll, 2000);
  };

  useEffect(() => {
    if (!readAddress) return;
    const save = (state: ReturnType<typeof useDawStore.getState>) => {
      if (state.songId !== song.id) return;
      const cached = readProject(song.id, readAddress);
      if (!cached) return;
      writeProject({ ...cached, song: { ...cached.song, url: state.tracks.find(track => track.id === 'master')?.clips[0]?.url ?? cached.song.url, duration: state.duration }, takes: state.takes, commits: state.commits, session: { tracks: state.tracks, originals: state.originals, operations: state.operations, bpm: state.bpm } }, readAddress);
    };
    return useDawStore.subscribe((state, previous) => {
      if (state.tracks !== previous.tracks || state.takes !== previous.takes || state.commits !== previous.commits || state.operations !== previous.operations || state.originals !== previous.originals || state.bpm !== previous.bpm) save(state);
    });
  }, [song.id, readAddress]);

  useEffect(() => {
    if (!readAddress) return;
    const pending = useDawStore.getState().operations.find(operation => ['pending', 'processing'].includes(operation.status));
    if (pending) { setProcessing(true); pollTask({ taskId: pending.id, task: pending.task as Task, stemId: pending.stemId }, readAddress); }
  }, [song.id, readAddress]);

  // Demix Stems
  const handleSeparateStems = async () => {
    if (processing) return;
    if (!effectiveAddress) { toast.error('Connect your account to separate tracks'); return; }
    setProcessing(true);
    setProgress(undefined);
    const operation = crypto.randomUUID();
    const scope = scopeRef.current;
    useDawStore.setState(state => ({ operations: [...state.operations, { id: operation, task: 'extract', status: 'submitting' }] }));
    try {
      const res = await sdk.fetch('/api/editing/separate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songId: song.id,
          userAddress: effectiveAddress,
            stemType: 'all',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to separate stems');
      }

      const data = await res.json();
      if (scope !== scopeRef.current) return;
      useDawStore.setState(state => ({ operations: state.operations.map(item => item.id === operation ? { ...item, id: data.taskId ?? operation, status: data.status } : item) }));
      if (data.status === 'ready') {
        setProcessing(false);
        setProgress(100);
        await loadSongData();
        useDawStore.setState(state => ({ operations: state.operations.filter(item => item.id !== (data.taskId ?? operation)) }));
        toast.success('Tracks separated');
        return;
      }
      toast.success('Separating tracks...');
      if (data.taskId) {
        pollTask({ taskId: data.taskId, task: data.task, stemId: data.stemId }, effectiveAddress!);
      }
    } catch (err: any) {
      if (scope !== scopeRef.current) return;
      setProcessing(false);
      useDawStore.setState(state => ({ operations: state.operations.map(item => item.id === operation ? { ...item, status: 'error', error: err.message } : item) }));
      toast.error(err.message || 'Stem isolation failed');
    }
  };

  // AI Task Execution Dispatcher
  const handleApplyEdit = async () => {
    if (processing) return;

    if (!effectiveAddress) {
      toast.error('Wallet connection required to process audio');
      return;
    }

    setProcessing(true);
    setProgress(undefined);
    const operation = crypto.randomUUID();
    const scope = scopeRef.current;
    useDawStore.setState(state => ({ operations: [...state.operations, { id: operation, task, status: 'submitting' }] }));

    try {
      if (!editing || (task !== 'extract' && !selectedQuality)) throw new Error('Music options are unavailable');
      let endpoint = '/api/editing/repaint';
      let payload: any = {
        songId: song.id,
        stemId: (() => { const candidate = takes.find(take => take.id === selectedTrackId); const id = candidate ? source(candidate, tracks) : selectedTrackId; if (!id) throw new Error('The source lane is unavailable'); return id !== 'master' ? id : undefined; })(),
        userAddress: effectiveAddress,
        modelQuality: task === 'extract' ? undefined : selectedQuality,
        ...Object.fromEntries(Object.entries(parameters).filter(([key]) => editing.parameters[key]?.tasks?.includes(task))),
      };
      if (typeof payload.trackClasses === 'string') payload.trackClasses = payload.trackClasses.split(',').map((value: string) => value.trim()).filter(Boolean);

      if (task === 'repaint' && !selection) throw new Error('Select a section to rework');
      const selectedTake = takes.find(take => take.id === selectedTrackId);
      const sourceRegion = selection && selectedTake ? sourceInterval(selectedTake,tracks,selection) : selection;
      const start = sourceRegion?.start;
      const end = sourceRegion?.end;

      if (task === 'repaint') {
        endpoint = '/api/editing/repaint';
        payload = {
          ...payload,
          prompt: prompt.trim() ? prompt.trim() : undefined,
          lyrics: lyrics.trim() ? lyrics : undefined,
          start,
          end,
          repaint_mode: repaintMode,
          repaint_strength: repaintMode === 'balanced' ? repaintStrength : undefined,
        };
      } else if (task === 'lego') {
        if (!instrument.trim()) throw new Error('Enter the instrument to add');
        if (!prompt.trim()) throw new Error('Describe the new part');
        const audio = await dawEngine.render(legoContextTrackIds, duration);
        const source = new FormData();
        source.append('file', audio, 'reference.wav');
        const upload = await sdk.fetch(`/api/editing/source?songId=${encodeURIComponent(song.id)}`, { method: 'POST', body: source });
        const uploaded = await upload.json();
        if (!upload.ok || !uploaded.url) throw new Error(uploaded.error || 'Could not save reference audio');
        endpoint = '/api/editing/layer';
        payload = {
          ...payload,
          stemId: undefined,
          srcAudioUrl: uploaded.url,
          trackName: instrument.trim(),
          prompt: prompt.trim(),
          audioDuration: duration,
          legoContextTrackIds,
        };
      } else if (task === 'extend') {
        endpoint = '/api/editing/extend';
        payload = {
          ...payload,
          prompt: prompt.trim() ? prompt.trim() : undefined,
          audioDuration: targetDuration,
        };
      } else if (task === 'cover') {
        endpoint = '/api/editing/remix';
        payload = {
          ...payload,
          prompt: prompt.trim(),
          coverStrength,
          coverNoiseStrength: parameters.coverNoiseStrength,
        };
      } else if (task === 'extract') {
        endpoint = '/api/editing/separate';
        payload = {
          ...payload,
          stemType,
        };
      }

      const res = await sdk.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Failed to dispatch ${task}`);
      }

      const data = await res.json();
      if (scope !== scopeRef.current) return;
      useDawStore.setState(state => ({ operations: state.operations.map(item => item.id === operation ? { ...item, id: data.taskId ?? operation, status: data.status, stemId: data.stemId } : item) }));
      if (data.status === 'ready') {
        setProcessing(false);
        setProgress(100);
        await showResult(data);
        useDawStore.setState(state => ({ operations: state.operations.filter(item => item.id !== (data.taskId ?? operation)) }));
        return;
      }
      toast.success('Processing audio...');
      if (data.taskId) {
        pollTask({ taskId: data.taskId, task: data.task, stemId: data.stemId }, effectiveAddress!);
      }
    } catch (err: any) {
      if (scope !== scopeRef.current) return;
      setProcessing(false);
      useDawStore.setState(state => ({ operations: state.operations.map(item => item.id === operation ? { ...item, status: 'error', error: err.message } : item) }));
      toast.error(err.message || 'Failed to process audio');
    }
  };

  const handleSelectTrack = useCallback((trackId: string) => {
    setSelectedTrackId(trackId);

    if (trackId === 'master') return;

    const currentTakes = useDawStore.getState().takes;
    const selectedTake = currentTakes.find((t) => t.id === trackId);
    if (selectedTake && selectedTake.url) {
      const mounted = useDawStore.getState().tracks.find(track => track.id === trackId && track.id === track.activeTakeId);
      const region = mounted?.clips.length ? {start:Math.min(...mounted.clips.map(clip => clip.startTime)),end:Math.max(...mounted.clips.map(clip => clip.startTime + clip.duration))} : selectedTake.provenance?.region;
      if (region && (!useDawStore.getState().selection || useDawStore.getState().selection!.start < region.start || useDawStore.getState().selection!.end > region.end)) setSelection(region);
      return;
    }

  }, [setSelectedTrackId, setSelection]);

  const handleReworkSection = useCallback(() => {
    const sel = useDawStore.getState().selection;
    if (sel) {
      setActiveTool('studio');
      setTask('repaint');
      setToolboxRevision(value => value + 1);
    } else {
      toast.error('Select a region on the timeline first to rework');
    }
  }, [setActiveTool, setTask, setPrompt]);

  return (
    <div className={`editor-container ${className}`} style={style}>
      {/* Top Workstation Bar */}
      <div className="editor-header-bar">
        <div className="editor-header-left">
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← STUDIO
          </Button>
          <div className="editor-header-text">
            <Glitch text={song.title} className="editor-track-title" />
            <div className="editor-track-sub">
              {duration.toFixed(1)}s • {tracks.length} TRACKS • {takes.length} TAKES • {bpm} BPM
            </div>
          </div>
        </div>

        <div className="editor-header-actions">
          <Tooltip title="Commit Snapshot" description="Save project milestone snapshot to timeline history">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsCommitModalOpen(true)}
            >
              <GitCommit size={13} /> COMMIT
            </Button>
          </Tooltip>
          {processing && (
            <Badge variant="secondary">
              PROCESSING {progress === undefined ? '' : `${progress}%`}
            </Badge>
          )}
        </div>
      </div>

      {/* Unified Multi-Track Board Viewport */}
      <div className="editor-board-wrapper">
        <Board
          song={song}
          selectedTrackId={selectedTrackId}
          onSelectTrack={handleSelectTrack}
          onAddTrack={handleAddTrack}
          onSeparateStems={handleSeparateStems}
          isSeparating={processing}
          onReworkSection={handleReworkSection}
        />
      </div>

      {/* Floating, Draggable & Resizable AI Studio Toolbox */}
      <Toolbox
        options={editing}
        optionsError={options.error?.message}
        parameters={parameters}
        onParametersChange={setParameters}
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        task={task}
        onSelectTask={setTask}
        prompt={prompt}
        onPromptChange={setPrompt}
        lyrics={lyrics}
        onLyricsChange={setLyrics}
        selectedQuality={selectedQuality}
        onQualityChange={setSelectedQuality}
        repaintMode={repaintMode}
        onRepaintModeChange={setRepaintMode}
          repaintStrength={repaintStrength}
          onRepaintStrengthChange={setRepaintStrength}
          instrument={instrument}
          onInstrumentChange={setInstrument}
        coverStrength={coverStrength}
        onCoverStrengthChange={setCoverStrength}
        targetDuration={targetDuration}
        onTargetDurationChange={setTargetDuration}
        stemType={stemType}
        onStemTypeChange={setStemType}
        onExecute={handleApplyEdit}
        processing={processing}
        progress={progress}
        reveal={toolboxRevision}
        selectedTrackId={selectedTrackId}
        onSelectTrack={handleSelectTrack}
        onClearSelection={() => setSelection(null)}
        onOpenCommitModal={() => setIsCommitModalOpen(true)}
      />

      {/* Commit Snapshot Modal Dialog */}
      {isCommitModalOpen && (
        <div className="editor-modal-overlay">
          <div className="editor-modal-card">
            <h3 className="editor-modal-title">COMMIT SNAPSHOT</h3>
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Enter snapshot description (e.g., Added vocal harmony and bassline)..."
              rows={3}
              className="editor-modal-textarea"
            />
            <div className="editor-modal-actions">
              <Button size="sm" variant="ghost" onClick={() => setIsCommitModalOpen(false)}>
                CANCEL
              </Button>
              <Button size="sm" variant="primary" onClick={handleCreateCommit}>
                SAVE SNAPSHOT
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
