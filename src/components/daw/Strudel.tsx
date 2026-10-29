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
  const pendingModalTrackId = useDawStore((s) => s.pendingModalTrackId);
  const clearPendingModalTrackId = useDawStore((s) => s.clearPendingModalTrackId);

  const strudelTrack =
    (track && track.type === 'strudel' ? track : null) ||
    tracks.find((t) => t.id === selectedTrackId && t.type === 'strudel') ||
    tracks.find((t) => t.type === 'strudel');

  const [code, setCode] = useState<string>(strudelTrack?.strudelCode || '');
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([
    `[${new Date().toLocaleTimeString()}] REPL READY • BPM: ${bpm}`,
  ]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

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
          <Terminal size={22} className="strudel-empty-icon" />
          <p className="strudel-empty-desc">
            Create a live coding pattern track to compose algorithmic music with Strudel REPL.
          </p>
          <Button
            size="sm"
            variant="default"
            onClick={() => {
              addTrack('strudel', 'Live Code');
              setIsModalOpen(true);
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

  const handleAiCompose = async () => {
    const trimmed = aiPrompt.trim();
    if (!trimmed || isGenerating) return;
    setIsGenerating(true);
    setConsoleLogs((prev) => [
      ...prev.slice(-20),
      `[${new Date().toLocaleTimeString()}] [AI] Analyzing song context & composing: "${trimmed}"...`,
    ]);
    try {
      const activeStems = tracks
        .filter((t) => t.id !== 'master' && t.id !== strudelTrack.id)
        .map((t) => t.name);
      const musicalContext = await extractMusicalContext(strudelTrack.id);
      const res = await sdk.fetch('/api/editing/strudel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          currentCode: code.trim() || undefined,
          bpm,
          timeSignature: Array.isArray(timeSignature) ? `${timeSignature[0]}/${timeSignature[1]}` : undefined,
          stems: activeStems.length ? activeStems : undefined,
          musicalContext,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.code) {
        throw new Error(data?.error || 'Failed to generate Strudel pattern');
      }
      setCode(data.code);
      await handleEvaluate(data.code);
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

  const lineCount = Math.max(8, code.split('\n').length);
  const lastLog = consoleLogs[consoleLogs.length - 1] || '';
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
        {inModal ? (
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
        ) : (
          <Tooltip title={lastLog} className="daw-preview-grow-wrap">
            <span className="daw-instrument-preview-code">
              {lastLog}
            </span>
          </Tooltip>
        )}
      </div>

      <div className="strudel-controls-cluster">
        <div className="strudel-ai-bar">
          <input
            type="text"
            className="toolbox-text-input strudel-ai-input"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAiCompose();
              }
            }}
            placeholder={
              inModal
                ? 'Describe pattern or transformation (e.g., "acid 303 bassline in C minor + syncopated hats")...'
                : 'AI Live-Code prompt...'
            }
            aria-label="AI Strudel live-coding prompt"
            disabled={isGenerating}
          />
          <Tooltip title="Compose or evolve Strudel pattern">
            <Button
              size="sm"
              variant="secondary"
              className="strudel-action-btn daw-ui-btn"
              onClick={() => void handleAiCompose()}
              disabled={isGenerating || !aiPrompt.trim()}
              aria-label="Compose Strudel pattern with AI"
            >
              <Sparkles size={11} />
              <span className="daw-btn-label">{isGenerating ? 'COMPOSING' : 'AI CODE'}</span>
            </Button>
          </Tooltip>
        </div>

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

        <Tooltip title="Clear Editor Buffer">
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
      </div>
    </div>
  );

  return (
    <div className="strudel-wrap daw-compact-instrument-deck">
      {/* Row 1: Single-Row Command Bar */}
      {renderToolbar(false)}

      {/* Row 2: Click-to-Expand Pattern Preview + Expand Modal Button */}
      <div className="daw-instrument-preview-row">
        <Tooltip
          title="Click to open full Strudel Live Code REPL Modal"
          className="daw-preview-grow-wrap"
        >
        <div
          className="daw-instrument-preview-viz"
          onClick={() => setIsModalOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsModalOpen(true);
            }
          }}
        >
          <span className="daw-instrument-preview-badge">REPL</span>
          <span className="daw-instrument-preview-code">
            {code.trim()
              ? code.replace(/\s+/g, ' ').trim()
              : "// s('bd [sd hh]*2').fast(2) — Click to open Live Code Editor..."}
          </span>
        </div>
        </Tooltip>

        <button
          type="button"
          className="daw-expand-modal-btn"
          onClick={() => setIsModalOpen(true)}
        >
          <Maximize2 size={12} />
          <span>OPEN CODE REPL</span>
        </button>
      </div>

      {/* Expanded Full-Featured Strudel Code REPL + Console Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`STRUDEL LIVE CODE REPL • ${strudelTrack.name.toUpperCase()}`}
        size="lg"
      >
        <div className="daw-instrument-modal-body">
          {renderToolbar(true)}

          {/* Bi-directional Live Macro Sliders */}
          <div className="strudel-macro-row">
            <Slider
              label="SPEED (.fast)"
              min={0.25}
              max={4}
              step={0.25}
              value={extractMacroVal('fast', 1)}
              defaultValue={1}
              onChange={(val) => applyMacroModifier('fast', val)}
              unit="x"
            />
            <Slider
              label="LPF CUTOFF (.lpf)"
              min={100}
              max={12000}
              step={100}
              value={extractMacroVal('lpf', 4200)}
              defaultValue={4200}
              onChange={(val) => applyMacroModifier('lpf', val)}
              unit="Hz"
            />
            <Slider
              label="REVERB (.room)"
              min={0}
              max={1}
              step={0.05}
              value={extractMacroVal('room', 0.2)}
              defaultValue={0.2}
              onChange={(val) => applyMacroModifier('room', val)}
              formatValue={(val) => `${Math.round(val * 100)}%`}
            />
            <Slider
              label="DELAY (.delay)"
              min={0}
              max={0.9}
              step={0.05}
              value={extractMacroVal('delay', 0.15)}
              defaultValue={0.15}
              onChange={(val) => applyMacroModifier('delay', val)}
              formatValue={(val) => `${Math.round(val * 100)}%`}
            />
          </div>

          {/* Editor Box */}
          <div className="strudel-editor-box">
            <div className="strudel-gutter">
              {Array.from({ length: lineCount }).map((_, i) => (
                <div key={i} className="strudel-line-num">
                  {i + 1}
                </div>
              ))}
            </div>

            <textarea
              ref={textareaRef}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                updateStrudelCode(strudelTrack.id, e.target.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder="// Enter Strudel pattern code (e.g., stack(s('bd*2 [~ sd] hh*4'), note('c2 [eb2 g2]').s('sawtooth').lpf(900)))&#10;// Press Shift+Enter to evaluate and sync to transport..."
              className="strudel-textarea"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
            />
          </div>

          {/* Console Terminal Log */}
          <div className="strudel-console">
            <div className="strudel-console-header">
              <span className="strudel-console-title">LOG</span>
              <span className="strudel-console-shortcut">Shift + Enter to Evaluate</span>
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

