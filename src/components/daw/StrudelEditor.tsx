import React, { useState, useEffect, useRef } from 'react';
import { useDawStore, DAWTrack } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { Button } from '../button';
import { Badge } from '../badge';
import { Terminal, Play, Square, Trash2, Plus } from 'lucide-react';

interface StrudelEditorProps {
  track?: DAWTrack;
}

export const StrudelEditor: React.FC<StrudelEditorProps> = ({ track }) => {
  const {
    tracks,
    selectedTrackId,
    addTrack,
    updateStrudelCode,
    bpm,
    isPlaying,
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

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (strudelTrack && strudelTrack.strudelCode !== undefined && strudelTrack.strudelCode !== code) {
      setCode(strudelTrack.strudelCode);
    }
  }, [strudelTrack?.id]);

  if (!strudelTrack) {
    return (
      <div className="strudel-wrap">
        <div className="strudel-empty-card">
          <Terminal size={32} className="strudel-empty-icon" />
          <h4 className="strudel-empty-title">NO LIVE CODE TRACK ACTIVE</h4>
          <p className="strudel-empty-desc">
            Create a live coding pattern track to compose algorithmic music with Strudel REPL.
          </p>
          <Button
            size="sm"
            variant="default"
            onClick={() => addTrack('strudel', 'Live Code')}
          >
            <Plus size={13} /> CREATE LIVE CODE TRACK
          </Button>
        </div>
      </div>
    );
  }

  const handleEvaluate = () => {
    if (!code.trim()) {
      setConsoleLogs((prev) => [
        ...prev.slice(-20),
        `[${new Date().toLocaleTimeString()}] [WARN] Buffer is empty. Enter a pattern statement.`,
      ]);
      return;
    }

    try {
      updateStrudelCode(strudelTrack.id, code);
      dawEngine.scheduleStrudel(strudelTrack.id, code, bpm);
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

  const handleStop = () => {
    dawEngine.stopTransport();
    setIsRunning(false);
    setConsoleLogs((prev) => [
      ...prev.slice(-20),
      `[${new Date().toLocaleTimeString()}] [INFO] Transport stopped`,
    ]);
  };

  const handleClear = () => {
    setCode('');
    updateStrudelCode(strudelTrack.id, '');
    setConsoleLogs((prev) => [
      ...prev.slice(-20),
      `[${new Date().toLocaleTimeString()}] [INFO] Buffer cleared`,
    ]);
  };

  // Keyboard shortcut: Shift+Enter to run
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleEvaluate();
    }
  };

  const lineCount = Math.max(8, code.split('\n').length);

  return (
    <div className="strudel-wrap">
      {/* Top Toolbar */}
      <div className="strudel-toolbar">
        <div className="strudel-meta">
          <Terminal size={14} className="strudel-meta-icon" />
          <span className="strudel-track-name">{strudelTrack.name}</span>
          <Badge variant={hasError ? 'warning' : isRunning ? 'default' : 'outline'}>
            {hasError ? 'ERROR' : isRunning && isPlaying ? 'PLAYING' : 'READY'}
          </Badge>
          <Badge variant="outline">{bpm} BPM</Badge>
        </div>

        <div className="strudel-controls-cluster">
          <Button
            size="sm"
            variant="default"
            className="strudel-action-btn run"
            onClick={handleEvaluate}
            title="Evaluate pattern (Shift+Enter)"
          >
            <Play size={11} /> RUN PATTERN
          </Button>

          {isRunning && (
            <Button
              size="sm"
              variant="secondary"
              className="strudel-action-btn"
              onClick={handleStop}
              title="Stop playback"
            >
              <Square size={11} /> STOP
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            className="strudel-action-btn"
            onClick={handleClear}
            title="Clear editor buffer"
          >
            <Trash2 size={11} /> CLEAR
          </Button>
        </div>
      </div>

      {/* Editor Box */}
      <div className="strudel-editor-box">
        {/* Line Numbers Gutter */}
        <div className="strudel-gutter">
          {Array.from({ length: lineCount }).map((_, i) => (
            <div key={i} className="strudel-line-num">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Code Textarea */}
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
        />
      </div>

      {/* Console Terminal Log */}
      <div className="strudel-console">
        <div className="strudel-console-header">
          <span className="strudel-console-title">REPL LOG</span>
          <span className="strudel-console-shortcut">Shift + Enter to execute</span>
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
  );
};
