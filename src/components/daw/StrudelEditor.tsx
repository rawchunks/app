import React, { useState, useEffect, useRef } from 'react';
import { useDawStore, DAWTrack } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { Button } from '../button';
import { Badge } from '../badge';
import { Modal } from '../modal';
import { Tooltip } from './Tooltip';
import { Terminal, Play, Trash2, Plus, Maximize2 } from 'lucide-react';

interface StrudelEditorProps {
  track?: DAWTrack;
}

const STRUDEL_STARTERS: { label: string; code: string }[] = [
  { label: '4/4 TECHNO', code: "s('bd*4, [~ cp]*2, hh*8')" },
  { label: 'BREAKBEAT', code: "s('bd [~ bd] sd [bd ~], hh*8').fast(1)" },
  { label: 'ACID BASS', code: "note('c2 [c2 g2] eb2 [f2 bb1]').s('sawtooth')" },
];

export const StrudelEditor: React.FC<StrudelEditorProps> = ({ track }) => {
  const {
    tracks,
    selectedTrackId,
    addTrack,
    updateStrudelCode,
    bpm,
    isPlaying,
    pendingModalTrackId,
    clearPendingModalTrackId,
  } = useDawStore();

  const strudelTrack =
    (track && track.type === 'strudel' ? track : null) ||
    tracks.find((t) => t.id === selectedTrackId && t.type === 'strudel') ||
    tracks.find((t) => t.type === 'strudel');

  const [code, setCode] = useState<string>(strudelTrack?.strudelCode || '');
  const [consoleLogs, setConsoleLogs] = useState<string[]>([
    `[${new Date().toLocaleTimeString()}] REPL READY • BPM: ${bpm}`,
  ]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (strudelTrack && pendingModalTrackId === strudelTrack.id) {
      setIsModalOpen(true);
      clearPendingModalTrackId();
    }
  }, [strudelTrack?.id, pendingModalTrackId, clearPendingModalTrackId]);

  useEffect(() => {
    if (strudelTrack && strudelTrack.strudelCode !== undefined && strudelTrack.strudelCode !== code) {
      setCode(strudelTrack.strudelCode);
    }
  }, [strudelTrack?.id]);

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

  const handleEvaluate = (overrideCode?: string) => {
    const targetCode = overrideCode !== undefined ? overrideCode : code;
    if (!targetCode.trim()) {
      setConsoleLogs((prev) => [
        ...prev.slice(-20),
        `[${new Date().toLocaleTimeString()}] [WARN] Buffer is empty. Enter a pattern statement.`,
      ]);
      return;
    }

    try {
      updateStrudelCode(strudelTrack.id, targetCode);
      dawEngine.scheduleStrudel(strudelTrack.id, targetCode, bpm);
      dawEngine.startTransport();
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

  const handleClear = () => {
    setCode('');
    updateStrudelCode(strudelTrack.id, '');
    setConsoleLogs((prev) => [
      ...prev.slice(-20),
      `[${new Date().toLocaleTimeString()}] [INFO] Buffer cleared`,
    ]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleEvaluate();
    }
  };

  const lineCount = Math.max(8, code.split('\n').length);
  const lastLog = consoleLogs[consoleLogs.length - 1] || '';

  const renderToolbar = (inModal = false) => (
    <div className="strudel-toolbar daw-ui-toolbar">
      <div className="strudel-meta">
        <Badge variant={hasError ? 'warning' : isRunning ? 'default' : 'outline'}>
          {hasError ? 'ERROR' : isRunning && isPlaying ? 'PLAYING' : 'READY'}
        </Badge>
        {inModal ? (
          <div className="strudel-starters-group">
            {STRUDEL_STARTERS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="daw-ui-btn"
                onClick={() => {
                  setCode(preset.code);
                  handleEvaluate(preset.code);
                }}
                title={`Load & evaluate ${preset.label}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="daw-instrument-preview-code" title={lastLog}>
            {lastLog}
          </span>
        )}
      </div>

      <div className="strudel-controls-cluster">
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
          title="Click to open full Strudel Live Code REPL Modal"
        >
          <span className="daw-instrument-preview-badge">REPL</span>
          <span className="daw-instrument-preview-code">
            {code.trim()
              ? code.replace(/\s+/g, ' ').trim()
              : "// s('bd [sd hh]*2').fast(2) — Click to open Live Code Editor..."}
          </span>
        </div>

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
              placeholder="// Enter Strudel pattern code (e.g., s('bd [sd hh]*2').fast(2))&#10;// Press Shift+Enter to evaluate and sync to transport..."
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
