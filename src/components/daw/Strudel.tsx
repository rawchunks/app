import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useDawStore, DAWTrack } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { extractMusicalContext } from '../../lib/daw/context';
import { validateStrudelPattern } from '../../lib/daw/strudel';
import { sdk } from '../../lib/sdk';
import { Button } from '../button';
import { Badge } from '../badge';
import { Modal } from '../modal';
import { Slider } from '../slider';
import { Tooltip } from './Tooltip';
import { Terminal, Play, Trash2, Plus, Maximize2, Sparkles } from 'lucide-react';

interface StrudelProps {
  track?: DAWTrack;
}

const STRUDEL_STARTERS: { label: string; code: string }[] = [
  { label: 'TECHNO', code: "s('bd*4, [~ cp]*2, [~ hh]*4').lpf(4200)" },
  { label: 'BREAKS', code: "s('<[bd [~ bd] sd [bd ~]] [bd [sd bd] [~ bd] sd]>, hh*8').room(0.25)" },
  { label: 'ACID', code: "note('<[c2 [c2 g2] eb2 [f2 bb1]] [ab1 [ab1 eb2] f2 [g2 d2]]>').s('sawtooth').lpf(900).delay(0.2)" },
];

export const Strudel: React.FC<StrudelProps> = ({ track }) => {
  const tracks = useDawStore((s) => s.tracks);
  const selectedTrackId = useDawStore((s) => s.selectedTrackId);
  const addTrack = useDawStore((s) => s.addTrack);
  const updateStrudelCode = useDawStore((s) => s.updateStrudelCode);
  const addSynthVersion = useDawStore((s) => s.addSynthVersion);
  const selectSynthVersion = useDawStore((s) => s.selectSynthVersion);
  const bpm = useDawStore((s) => s.bpm);
  const timeSignature = useDawStore((s) => s.timeSignature);
  const isPlaying = useDawStore((s) => s.isPlaying);
  const songId = useDawStore((s) => s.songId);
  const keyScale = useDawStore((s) => s.keyScale);
  const stylePrompt = useDawStore((s) => s.stylePrompt);
  const selection = useDawStore((s) => s.selection);
  const pendingModalTrackId = useDawStore((s) => s.pendingModalTrackId);
  const clearPendingModalTrackId = useDawStore((s) => s.clearPendingModalTrackId);

  const strudelTrack =
    (track && track.type === 'strudel' ? track : null) ||
    tracks.find((t) => t.id === selectedTrackId && t.type === 'strudel') ||
    tracks.find((t) => t.type === 'strudel');

  const audioTracks = tracks.filter(
    (t) => t.type !== 'strudel' && t.type !== 'pianoroll' && t.type !== 'sequencer'
  );

  const [code, setCode] = useState<string>(strudelTrack?.strudelCode || '');
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [refTrackId, setRefTrackId] = useState<string>('auto');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([
    `[${new Date().toLocaleTimeString()}] REPL READY • BPM: ${bpm}`,
  ]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [focusPane, setFocusPane] = useState<'code' | 'prompt'>('code');

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const codeSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedCodeRef = useRef<string | undefined>(strudelTrack?.strudelCode);

  const flushPendingCodeSync = (trackId: string, nextCode: string) => {
    if (codeSyncTimerRef.current) {
      clearTimeout(codeSyncTimerRef.current);
      codeSyncTimerRef.current = null;
    }
    lastPushedCodeRef.current = nextCode;
    updateStrudelCode(trackId, nextCode);
  };

  const scheduleCodeSync = (trackId: string, nextCode: string) => {
    lastPushedCodeRef.current = nextCode;
    if (codeSyncTimerRef.current) {
      clearTimeout(codeSyncTimerRef.current);
    }
    codeSyncTimerRef.current = setTimeout(() => {
      codeSyncTimerRef.current = null;
      updateStrudelCode(trackId, nextCode);
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (codeSyncTimerRef.current) {
        clearTimeout(codeSyncTimerRef.current);
        codeSyncTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (strudelTrack && pendingModalTrackId === strudelTrack.id) {
      setIsModalOpen(true);
      clearPendingModalTrackId();
    }
  }, [strudelTrack?.id, pendingModalTrackId, clearPendingModalTrackId]);

  useEffect(() => {
    if (!strudelTrack || strudelTrack.strudelCode === undefined) return;
    if (!codeSyncTimerRef.current && strudelTrack.strudelCode !== code) {
      lastPushedCodeRef.current = strudelTrack.strudelCode;
      setCode(strudelTrack.strudelCode);
    }
  }, [strudelTrack?.id, strudelTrack?.activeVersionId, strudelTrack?.strudelCode]);

  if (!strudelTrack) {
    return (
      <div className="strudel-wrap">
        <div className="strudel-empty-card">
          <Terminal size={20} className="strudel-empty-icon" />
          <Button
            size="sm"
            variant="default"
            onClick={() => {
              addTrack('strudel', 'Code');
            }}
          >
            <Plus size={13} /> CREATE CODE TRACK
          </Button>
        </div>
      </div>
    );
  }

  const handleEvaluate = async (overrideCode?: string) => {
    const targetCode = overrideCode !== undefined ? overrideCode : code;
    if (!targetCode.trim()) {
      setConsoleLogs((prev) => [
        ...prev.slice(-20),
        `[${new Date().toLocaleTimeString()}] [WARN] Buffer is empty. Enter a pattern statement.`,
      ]);
      return;
    }

    try {
      const validation = validateStrudelPattern(targetCode);
      if (!validation.valid) {
        throw new Error(validation.errors.join(' ') || 'Invalid Strudel pattern syntax');
      }
      flushPendingCodeSync(strudelTrack.id, targetCode);
      if (!isPlaying) {
        await dawEngine.startTransport();
      }
      dawEngine.scheduleStrudel(strudelTrack.id, targetCode, bpm);
      setIsRunning(true);
      setHasError(false);
      setConsoleLogs((prev) => [
        ...prev.slice(-20),
        `[${new Date().toLocaleTimeString()}] [OK] Pattern compiled & synced to ${bpm} BPM`,
      ]);
    } catch (err: any) {
      setHasError(true);
      setConsoleLogs((prev) => [
        ...prev.slice(-20),
        `[${new Date().toLocaleTimeString()}] [ERR] ${err.message || 'Syntax or evaluation error'}`,
      ]);
    }
  };

  const extractMacroVal = (method: string, fallback: number): number => {
    const regex = new RegExp(`\\.${method}\\(\\s*([\\d.]+)\\s*\\)`);
    const match = code.match(regex);
    if (!match) return fallback;
    const parsed = parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const applyMacroModifier = (method: 'fast' | 'lpf' | 'room' | 'delay', value: number) => {
    const baseCode = code.trim() || STRUDEL_STARTERS[0].code;
    const regex = new RegExp(`\\.${method}\\(\\s*[\\d.]+\\s*\\)`);
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
    const nextCode = regex.test(baseCode)
      ? baseCode.replace(regex, `.${method}(${formatted})`)
      : `${baseCode}.${method}(${formatted})`;
    setCode(nextCode);
    scheduleCodeSync(strudelTrack.id, nextCode);
  };

  const resolvedRefTrack =
    refTrackId !== 'auto'
      ? audioTracks.find((t) => t.id === refTrackId) || audioTracks[0]
      : audioTracks.find((t) => t.id === selectedTrackId && t.id !== 'master') ||
      audioTracks.find((t) => t.id === 'master') ||
      audioTracks[0];

  const handleAiCompose = async () => {
    const trimmed = aiPrompt.trim();
    if (!trimmed || isGenerating) return;
    setIsGenerating(true);
    const refLabel = resolvedRefTrack?.name || 'Master';
    setConsoleLogs((prev) => [
      ...prev.slice(-20),
      `[${new Date().toLocaleTimeString()}] [AI] Analyzing ${refLabel.toUpperCase()} context & composing: "${trimmed}"...`,
    ]);
    try {
      const activeStems = tracks
        .filter((t) => t.id !== 'master' && t.id !== strudelTrack.id)
        .map((t) => t.name);
      const targetRefTrackId = resolvedRefTrack?.id || 'master';
      const musicalContext = await extractMusicalContext(targetRefTrackId);
      const trackPayload = tracks
        .filter((t) => t.id !== 'master')
        .map((t) => ({
          id: t.id,
          name: t.name,
          type: t.type,
          muted: t.muted,
          solo: t.solo,
        }));
      const res = await sdk.fetch('/api/strudel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          songId: songId || undefined,
          prompt: trimmed,
          currentCode: code.trim() || undefined,
          bpm,
          keyScale: keyScale || undefined,
          stylePrompt: stylePrompt || undefined,
          timeSignature: Array.isArray(timeSignature) ? `${timeSignature[0]}/${timeSignature[1]}` : undefined,
          selectedTrack: refLabel,
          selection: selection
            ? { start: selection.start, end: selection.end }
            : undefined,
          playhead: useDawStore.getState().playhead,
          stems: activeStems.length ? activeStems : undefined,
          tracks: trackPayload,
          musicalContext,
          stream: true,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || `Failed to generate Strudel pattern (${res.status})`);
      }

      const contentType = res.headers.get('content-type') || '';
      let finalCode = '';

      if (contentType.includes('application/x-ndjson') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processLine = (rawLine: string) => {
          const line = rawLine.trim();
          if (!line) return;
          let evt: any;
          try {
            evt = JSON.parse(line);
          } catch {
            return;
          }
          if (evt.type === 'graph') {
            setConsoleLogs((prev) => [
              ...prev.slice(-20),
              `[${new Date().toLocaleTimeString()}] [GRAPH] ${String(evt.intent || 'compose').toUpperCase()} [${(evt.targetLayers || []).join('+')}] -> libs:(${(evt.mountedLibraries || []).join(',')}) • ${evt.archetypeLabel || evt.archetypeId} (${evt.estimatedTokens} tok)`,
            ]);
          } else if (evt.type === 'status' && evt.step) {
            setConsoleLogs((prev) => [
              ...prev.slice(-20),
              `[${new Date().toLocaleTimeString()}] [REACT] ${evt.step}`,
            ]);
          } else if (evt.type === 'reasoning' && evt.text) {
            setConsoleLogs((prev) => [
              ...prev.slice(-20),
              `[${new Date().toLocaleTimeString()}] [REASON] ${evt.text}`,
            ]);
          } else if (evt.type === 'code' && evt.code) {
            finalCode = evt.code;
            setCode(evt.code);
          } else if (evt.type === 'done' && evt.code) {
            finalCode = evt.code;
            setCode(evt.code);
          } else if (evt.type === 'error') {
            throw new Error(evt.message || 'Algorithmic Composer stream failed');
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            processLine(line);
          }
        }
        if (buffer.trim()) {
          processLine(buffer);
        }
      } else {
        const data = await res.json();
        if (!data?.code) {
          throw new Error(data?.error || 'Failed to generate Strudel pattern');
        }
        finalCode = data.code;
        setCode(finalCode);
      }

      if (!finalCode) {
        throw new Error('Failed to generate Strudel pattern');
      }

      await handleEvaluate(finalCode);
      setAiPrompt('');
      toast.success('Strudel pattern composed and synced to transport');
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'AI live-code generation failed';
      setHasError(true);
      setConsoleLogs((prev) => [
        ...prev.slice(-20),
        `[${new Date().toLocaleTimeString()}] [ERR] ${msg}`,
      ]);
      toast.error(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClear = () => {
    setCode('');
    flushPendingCodeSync(strudelTrack.id, '');
    setConsoleLogs((prev) => [
      ...prev.slice(-20),
      `[${new Date().toLocaleTimeString()}] [INFO] Buffer cleared`,
    ]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      void handleEvaluate();
    }
  };

  const versions = strudelTrack.versions && strudelTrack.versions.length > 0
    ? strudelTrack.versions
    : [{ id: '1', number: 1, createdAt: 0 }];
  const activeVerId = strudelTrack.activeVersionId || versions[versions.length - 1].id;

  const renderToolbar = (inModal = false) => (
    <div className="strudel-toolbar daw-ui-toolbar">
      <div className="strudel-meta">
        <div className="synth-version-pills">
          {versions.map((ver) => (
            <Tooltip key={ver.id} title={`Code Version #${ver.number}`}>
              <button
                type="button"
                className={`synth-ver-pill ${activeVerId === ver.id ? 'active' : ''}`}
                onClick={() => selectSynthVersion(strudelTrack.id, ver.id)}
              >
                #{ver.number}
              </button>
            </Tooltip>
          ))}
          <Tooltip title="New Code Version" description="Create a fresh version (#N+1) on this Code lane">
            <button
              type="button"
              className="synth-ver-pill add"
              onClick={() => addSynthVersion(strudelTrack.id)}
              aria-label="Create new Code version"
            >
              <Plus size={11} />
            </button>
          </Tooltip>
        </div>
        <Badge variant={hasError ? 'warning' : isRunning ? 'default' : 'outline'}>
          {hasError ? 'ERROR' : isRunning && isPlaying ? 'PLAYING' : 'READY'}
        </Badge>
        {inModal && (
          <div className="strudel-starters-group">
            {STRUDEL_STARTERS.map((preset) => (
              <Tooltip key={preset.label} title={`Load & evaluate ${preset.label}`}>
                <button
                  type="button"
                  className="daw-ui-btn"
                  onClick={() => {
                    setCode(preset.code);
                    handleEvaluate(preset.code);
                  }}
                >
                  {preset.label}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
      </div>

      <div className="strudel-controls-cluster">
        {audioTracks.length > 0 && (
          <Tooltip
            title="Reference Track"
            description={`Lock groove, chords, and mix context to ${resolvedRefTrack?.name || 'Master'}`}
          >
            <select
              className="toolbox-select-compact daw-ui-btn strudel-ref-select"
              value={refTrackId}
              onChange={(e) => setRefTrackId(e.target.value)}
              aria-label="Reference track for AI Strudel context"
              disabled={isGenerating}
            >
              <option value="auto">REF: AUTO</option>
              {audioTracks.map((t) => (
                <option key={t.id} value={t.id}>
                  REF: {t.id === 'master' ? 'MASTER' : t.name.toUpperCase()}
                </option>
              ))}
            </select>
          </Tooltip>
        )}

        <Tooltip title="Evaluate Pattern (Shift+Enter)">
          <Button
            size="sm"
            variant="default"
            className="strudel-action-btn daw-ui-btn run"
            onClick={() => handleEvaluate()}
          >
            <Play size={11} />
            <span className="daw-btn-label">RUN</span>
          </Button>
        </Tooltip>

        <Tooltip title="Clear Buffer">
          <Button
            size="sm"
            variant="outline"
            className="strudel-action-btn daw-ui-btn danger"
            onClick={handleClear}
            aria-label="Clear code buffer"
          >
            <Trash2 size={11} />
          </Button>
        </Tooltip>

        {!inModal && (
          <Tooltip title="Open Full REPL Modal">
            <Button
              size="sm"
              variant="outline"
              className="strudel-action-btn daw-ui-btn"
              onClick={() => setIsModalOpen(true)}
              aria-label="Open full Strudel REPL modal"
            >
              <Maximize2 size={11} />
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );

  const renderSplitWorkspace = (inModal = false) => {
    const minLines = inModal ? (focusPane === 'code' ? 7 : 3) : (focusPane === 'code' ? 3 : 2);
    const currentLineCount = Math.max(minLines, code.split('\n').length);

    return (
      <div
        className="strudel-split-workspace"
        data-focus={focusPane}
        data-modal={inModal ? 'true' : 'false'}
      >
        {/* Code Section (Top) */}
        <div className="strudel-code-pane" onClick={() => setFocusPane('code')}>
          <div className="strudel-editor-box">
            <div className="strudel-gutter">
              {Array.from({ length: currentLineCount }).map((_, i) => (
                <div key={i} className="strudel-line-num">
                  {i + 1}
                </div>
              ))}
            </div>

            <textarea
              ref={inModal ? textareaRef : undefined}
              value={code}
              onFocus={() => setFocusPane('code')}
              onChange={(e) => {
                const nextVal = e.target.value;
                setCode(nextVal);
                scheduleCodeSync(strudelTrack.id, nextVal);
              }}
              onKeyDown={handleKeyDown}
              placeholder="// s('bd*2 [~ sd] hh*4').fast(2)"
              className="strudel-textarea"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus={inModal}
            />
          </div>
        </div>

        {/* Prompt Section + Sparkle & Expander (Bottom) */}
        <div className="strudel-prompt-pane">
          <div
            className="strudel-prompt-box-wrap"
            data-expanded={focusPane === 'prompt' ? 'true' : 'false'}
          >
            <textarea
              className="toolbox-text-input strudel-prompt-textarea"
              rows={focusPane === 'prompt' ? 3 : 2}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleAiCompose();
                }
              }}
              placeholder="Prompt pattern or transformation..."
              aria-label="AI Strudel live-coding prompt"
              disabled={isGenerating}
            />
            <Tooltip
              title={focusPane === 'prompt' ? 'Focus Code' : 'Expand Prompt'}
              className="strudel-prompt-expand-wrap"
            >
              <button
                type="button"
                className={`strudel-prompt-expand-btn ${focusPane === 'prompt' ? 'is-active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setFocusPane((prev) => (prev === 'prompt' ? 'code' : 'prompt'));
                }}
                aria-label={focusPane === 'prompt' ? 'Focus code section' : 'Expand prompt section'}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
            </Tooltip>
          </div>

          <Tooltip title={isGenerating ? 'Composing pattern...' : 'Compose with AI'}>
            <Button
              size="sm"
              variant="secondary"
              className="strudel-action-btn strudel-sparkle-btn daw-ui-btn"
              onClick={() => void handleAiCompose()}
              disabled={isGenerating || !aiPrompt.trim()}
              aria-label="Compose Strudel pattern with AI"
            >
              <Sparkles size={13} />
            </Button>
          </Tooltip>
        </div>
      </div>
    );
  };

  return (
    <div className="strudel-wrap daw-compact-instrument-deck">
      {/* Row 1: Single-Row Command Bar */}
      {renderToolbar(false)}

      {/* Row 2+: Dynamic Focus Split Workspace (only mounted here when modal is closed) */}
      {!isModalOpen && renderSplitWorkspace(false)}

      {/* Expanded Full-Featured Strudel Code REPL + Console Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`STRUDEL REPL • ${strudelTrack.name.toUpperCase()}`}
        size="lg"
      >
        <div className="daw-instrument-modal-body">
          {renderToolbar(true)}

          {/* Bi-directional Live Macro Sliders */}
          <div className="strudel-macro-row">
            <Slider
              label="SPEED"
              min={0.25}
              max={4}
              step={0.25}
              value={extractMacroVal('fast', 1)}
              defaultValue={1}
              onChange={(val) => applyMacroModifier('fast', val)}
              unit="x"
            />
            <Slider
              label="LPF"
              min={100}
              max={12000}
              step={100}
              value={extractMacroVal('lpf', 4200)}
              defaultValue={4200}
              onChange={(val) => applyMacroModifier('lpf', val)}
              unit="Hz"
            />
            <Slider
              label="REVERB"
              min={0}
              max={1}
              step={0.05}
              value={extractMacroVal('room', 0.2)}
              defaultValue={0.2}
              onChange={(val) => applyMacroModifier('room', val)}
              formatValue={(val) => `${Math.round(val * 100)}%`}
            />
            <Slider
              label="DELAY"
              min={0}
              max={0.9}
              step={0.05}
              value={extractMacroVal('delay', 0.15)}
              defaultValue={0.15}
              onChange={(val) => applyMacroModifier('delay', val)}
              formatValue={(val) => `${Math.round(val * 100)}%`}
            />
          </div>

          {/* Dynamic Focus Split Workspace (Code + Bottom Prompt/Sparkle/Expander) */}
          {renderSplitWorkspace(true)}

          {/* Console Terminal Log */}
          <div className="strudel-console">
            <div className="strudel-console-header">
              <span className="strudel-console-title">LOG</span>
            </div>
            <div className="strudel-console-body">
              {consoleLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={`strudel-log-line ${log.includes('[ERR]') ? 'err' : log.includes('[OK]') ? 'ok' : ''}`}
                >
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

