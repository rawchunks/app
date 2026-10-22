import React, { useState, useEffect, useRef } from 'react';
import {
  useDawStore,
  isTrackMixerModified,
  isTrackFxModified,
  isTrackSynthModified,
} from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { mounted, taskLabel } from '../../lib/daw/takes';
import { toast } from 'sonner';
import {
  Sliders,
  Drum,
  Terminal,
  Activity,
  Plus,
  History,
  Trash2,
} from 'lucide-react';
import { Rack } from './Rack';
import { Keys, Key } from './Keys';
import { Drums } from './Drums';
import { Strudel } from './Strudel';
import { Sampler } from './Sampler';
import { Mixer } from './mixer';
import { Tooltip } from './Tooltip';

export type ManualToolId = 'dsp' | 'mixer' | 'keys' | 'drums' | 'strudel' | 'sample' | 'history';
export type ManualToolTab = ManualToolId;
export type ActiveTool = ManualToolId | 'studio' | null;
export type MobileWorkspacePane = 'board' | 'studio' | 'toolbox';

export interface ToolboxProps {
  activeTool: ActiveTool;
  onSelectTool: (tool: ActiveTool) => void;
  selectedTrackId: string;
  onSelectTrack?: (trackId: string) => void;
  onOpenCommitModal: () => void;
  mobileFocused?: boolean;
  onMobileFocus?: () => void;
}

interface ToolMicroPreviewProps {
  toolId: ManualToolId;
}

const ToolMicroPreview: React.FC<ToolMicroPreviewProps> = ({ toolId }) => {
  const tracks = useDawStore((s) => s.tracks);
  const selectedTrackId = useDawStore((s) => s.selectedTrackId);
  const takes = useDawStore((s) => s.takes);
  const commits = useDawStore((s) => s.commits);
  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) || tracks[0];

  if (toolId === 'mixer') {
    const visibleTracks = tracks.slice(0, 5);
    return (
      <svg className="toolbox-micro-svg" viewBox="0 0 68 24" aria-hidden="true">
        {visibleTracks.map((t, i) => {
          const x = 6 + i * 13;
          const norm = Math.max(0.28, Math.min(1, (t.volume ?? 0.8) / 1.2));
          const h = Math.round(norm * 18);
          const y = 21 - h;
          return (
            <g key={t.id}>
              <line x1={x + 3} y1={3} x2={x + 3} y2={21} stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
              <rect
                x={x}
                y={y}
                width={6}
                height={h}
                rx={1.5}
                fill={t.muted ? 'rgba(255,255,255,0.2)' : t.color || 'var(--primary)'}
                opacity={0.9}
              />
              <rect x={x - 1} y={Math.max(3, y - 1)} width={8} height={2.5} rx={1} fill="#ffffff" />
            </g>
          );
        })}
      </svg>
    );
  }

  if (toolId === 'dsp') {
    const eqLow = selectedTrack?.fx?.eq?.low ?? 0;
    const eqMid = selectedTrack?.fx?.eq?.mid ?? 0;
    const eqHigh = selectedTrack?.fx?.eq?.high ?? 0;
    const y1 = 15 - Math.max(-7, Math.min(7, eqLow * 0.5));
    const y2 = 8 - Math.max(-7, Math.min(7, eqMid * 0.5));
    const y3 = 13 - Math.max(-7, Math.min(7, eqHigh * 0.5));
    return (
      <svg className="toolbox-micro-svg" viewBox="0 0 68 24" aria-hidden="true">
        <line x1="2" y1="12" x2="66" y2="12" stroke="rgba(255,255,255,0.18)" strokeDasharray="2 2" strokeWidth="1" />
        <path
          d={`M 3 ${y1} Q 20 ${y1 - 3}, 34 ${y2} T 65 ${y3}`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="14" cy={y1} r="2.5" fill="var(--primary)" />
        <circle cx="34" cy={y2} r="2.5" fill="#ffffff" />
        <circle cx="54" cy={y3} r="2.5" fill="var(--accent)" />
      </svg>
    );
  }

  if (toolId === 'keys') {
    const notes = selectedTrack?.pianoRollNotes?.slice(0, 6) || [];
    return (
      <svg className="toolbox-micro-svg" viewBox="0 0 68 24" aria-hidden="true">
        {notes.length > 0 ? (
          notes.map((n, idx) => (
            <rect
              key={`${n.id}-${idx}`}
              x={4 + (idx * 10) % 56}
              y={4 + ((84 - (n.midi || 60)) * 2) % 14}
              width={Math.max(6, Math.min(14, n.duration * 4))}
              height={3.2}
              rx={1.2}
              fill="var(--primary)"
            />
          ))
        ) : (
          <>
            <rect x="5" y="14" width="11" height="3.2" rx="1.2" fill="var(--primary)" />
            <rect x="19" y="9" width="13" height="3.2" rx="1.2" fill="var(--accent)" />
            <rect x="35" y="6" width="10" height="3.2" rx="1.2" fill="var(--primary)" />
            <rect x="48" y="12" width="14" height="3.2" rx="1.2" fill="var(--accent)" />
          </>
        )}
      </svg>
    );
  }

  if (toolId === 'drums') {
    return (
      <svg className="toolbox-micro-svg" viewBox="0 0 68 24" aria-hidden="true">
        {[0, 1, 2].map((row) =>
          [0, 1, 2, 3, 4, 5, 6, 7].map((col) => {
            const active = (row === 0 && col % 4 === 0) || (row === 1 && col % 4 === 2) || (row === 2 && col % 2 === 1);
            return (
              <rect
                key={`${row}-${col}`}
                x={4 + col * 7.8}
                y={3.5 + row * 6.2}
                width={5.4}
                height={4.2}
                rx={1}
                fill={active ? (row === 0 ? 'var(--primary)' : 'var(--accent)') : 'rgba(255,255,255,0.12)'}
              />
            );
          }),
        )}
      </svg>
    );
  }

  if (toolId === 'strudel') {
    return (
      <svg className="toolbox-micro-svg" viewBox="0 0 68 24" aria-hidden="true">
        <polyline points="5,7 11,12 5,17" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="15" y1="16" x2="26" y2="16" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
        <rect x="31" y="7" width="32" height="3" rx="1.5" fill="rgba(255,255,255,0.28)" />
        <rect x="31" y="13" width="22" height="3" rx="1.5" fill="var(--primary)" opacity="0.75" />
      </svg>
    );
  }

  if (toolId === 'sample') {
    const bars = [0.3, 0.75, 0.5, 0.95, 0.4, 0.85, 0.6, 0.35, 0.7, 0.45];
    return (
      <svg className="toolbox-micro-svg" viewBox="0 0 68 24" aria-hidden="true">
        {bars.map((b, i) => {
          const h = Math.round(b * 16);
          return (
            <rect
              key={i}
              x={5 + i * 5.8}
              y={12 - h / 2}
              width={3.2}
              height={h}
              rx={1}
              fill={i >= 3 && i <= 6 ? 'var(--primary)' : 'rgba(255,255,255,0.35)'}
            />
          );
        })}
        <line x1="21" y1="2" x2="21" y2="22" stroke="#ffffff" strokeWidth="1.2" strokeDasharray="2 1" />
        <line x1="44" y1="2" x2="44" y2="22" stroke="#ffffff" strokeWidth="1.2" strokeDasharray="2 1" />
      </svg>
    );
  }

  // history
  return (
    <svg className="toolbox-micro-svg" viewBox="0 0 68 24" aria-hidden="true">
      <line x1="8" y1="12" x2="60" y2="12" stroke="rgba(255,255,255,0.25)" strokeWidth="1.8" />
      {[14, 30, 46, 58].map((cx, i) => (
        <circle
          key={cx}
          cx={cx}
          cy={12}
          r={i === 2 ? 4 : 3}
          fill={i < takes.length + commits.length ? 'var(--primary)' : 'rgba(255,255,255,0.28)'}
          stroke="#0b0d12"
          strokeWidth="1.2"
        />
      ))}
    </svg>
  );
};

export const Toolbox: React.FC<ToolboxProps> = ({
  activeTool,
  onSelectTool,
  selectedTrackId,
  onSelectTrack,
  onOpenCommitModal,
  onMobileFocus,
}) => {
  const tracks = useDawStore((s) => s.tracks);
  const takes = useDawStore((s) => s.takes);
  const commits = useDawStore((s) => s.commits);
  const toggleTake = useDawStore((s) => s.toggleTake);
  const deleteTake = useDawStore((s) => s.deleteTake);
  const isPlaying = useDawStore((s) => s.isPlaying);
  const setPlaying = useDawStore((s) => s.setPlaying);

  const resolvedActiveTool: ManualToolId =
    activeTool && activeTool !== 'studio' ? activeTool : 'dsp';

  const [mruTool, setMruTool] = useState<ManualToolId>('mixer');
  const prevToolRef = useRef<ManualToolId>(resolvedActiveTool);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (resolvedActiveTool !== prevToolRef.current) {
      setMruTool(prevToolRef.current);
      prevToolRef.current = resolvedActiveTool;
    }
  }, [resolvedActiveTool]);

  useEffect(() => {
    if (!isOverflowOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setIsOverflowOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [isOverflowOpen]);

  const [historyTab, setHistoryTab] = useState<'takes' | 'commits'>('takes');
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);

  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) || tracks[0];

  const isMixerDirty = tracks.some((t) => isTrackMixerModified(t));
  const isDspDirty = tracks.some((t) => isTrackFxModified(t));
  const isKeysDirty = tracks.some((t) => t.type === 'pianoroll' && isTrackSynthModified(t));
  const isDrumsDirty = tracks.some((t) => t.type === 'sequencer' && isTrackSynthModified(t));
  const isStrudelDirty = tracks.some((t) => t.type === 'strudel' && isTrackSynthModified(t));

  const manualTools: Array<{
    id: ManualToolId;
    label: string;
    meta: string;
    desc: string;
    icon: React.ComponentType<{ size?: number }>;
    className: string;
    dirty: boolean;
  }> = [
      { id: 'dsp', label: 'FX', meta: 'SCULPT+EQ', desc: 'Wave-Design, Peak-Sculpt, Parametric EQ, Compression & Spatial FX', icon: Activity, className: 'tab-dsp', dirty: isDspDirty },
      { id: 'mixer', label: 'MIXER', meta: `${tracks.length} CH`, desc: 'Multitrack faders, stereo pan, mute & solo console', icon: Sliders, className: 'tab-mixer', dirty: isMixerDirty },
      { id: 'keys', label: 'KEYS', meta: 'MIDI', desc: 'Polyphonic piano roll MIDI composer & note editor', icon: Key, className: 'tab-keys', dirty: isKeysDirty },
      { id: 'drums', label: 'DRUMS', meta: '16-STEP', desc: '16-step polyphonic drum pattern sequencer', icon: Drum, className: 'tab-drums', dirty: isDrumsDirty },
      { id: 'strudel', label: 'CODE', meta: 'REPL', desc: 'Strudel live-coding pattern synthesizer', icon: Terminal, className: 'tab-strudel', dirty: isStrudelDirty },
      { id: 'sample', label: 'SAMPLE', meta: 'AUDIO', desc: 'Import and slice external audio samples into stems', icon: Plus, className: 'tab-sample', dirty: false },
      { id: 'history', label: 'HISTORY', meta: `${takes.length}T·${commits.length}C`, desc: `Session takes (${takes.length}) and saved commits (${commits.length})`, icon: History, className: 'tab-history', dirty: false },
    ];

  const activeToolDef = manualTools.find((t) => t.id === resolvedActiveTool) || manualTools[0];
  const mruToolDef =
    manualTools.find((t) => t.id === mruTool && t.id !== resolvedActiveTool) ||
    manualTools.find((t) => t.id !== resolvedActiveTool) ||
    manualTools[1];

  // Primary 2 quick-access tool icons shown directly in the dock (excluding the active tool & MRU slot so there is zero duplication)
  const dockCandidates = manualTools.filter(
    (t) => t.id !== mruToolDef.id && t.id !== resolvedActiveTool
  );
  const primaryDockTools = dockCandidates.slice(0, 2);
  const overflowDockTools = dockCandidates.slice(2);
  const isOverflowToolActive = false;

  const formatTime = (sec: number) => {
    const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
    const m = Math.floor(safe / 60);
    const s = Math.floor(safe % 60);
    const ms = Math.floor((safe % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  const handlePickTool = (id: ManualToolId) => {
    onSelectTool(id);
    setIsOverflowOpen(false);
    if (onMobileFocus) onMobileFocus();
  };

  return (
    <section
      aria-label="Manual Editing Toolbox"
      className="toolbox-bento-card"
    >
      {/* Main Structure: Top = SELECTED TOOL Workspace, Bottom = [MRU - PREVIEW] | [TOOL ICON] x 3 | [+N] */}
      <div className="toolbox-bento-body">
        <div className="toolbox-selected-tool-body">
          {resolvedActiveTool === 'dsp' && <Rack track={selectedTrack} />}
          {resolvedActiveTool === 'mixer' && <Mixer />}
          {resolvedActiveTool === 'keys' && <Keys track={selectedTrack} />}
          {resolvedActiveTool === 'drums' && <Drums track={selectedTrack} />}
          {resolvedActiveTool === 'strudel' && <Strudel track={selectedTrack} />}
          {resolvedActiveTool === 'sample' && <Sampler onImportComplete={() => handlePickTool('dsp')} />}
          {resolvedActiveTool === 'history' && (() => {
            const sortedTakes = [...takes].sort((a, b) => (a.take_number ?? 0) - (b.take_number ?? 0));
            const visibleTakes = sortedTakes;

            const sortedCommits = [...commits].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            const commitChronoNumMap = new Map<string, number>();
            sortedCommits.forEach((c, idx) => {
              commitChronoNumMap.set(c.id, idx + 1);
            });
            const getCommitCat = (c: (typeof commits)[number]) => {
              if (c.timeline_snapshot?.action) {
                return taskLabel(String(c.timeline_snapshot.action)).toUpperCase();
              }
              if (Array.isArray(c.timeline_snapshot?.tracks)) {
                return 'SNAPSHOT';
              }
              const msg = (c.message || '').toLowerCase();
              if (msg.includes('repaint') || msg.includes('rework')) return 'REWORK';
              if (msg.includes('extend')) return 'EXTEND';
              if (msg.includes('extract') || msg.includes('stem')) return 'ISOLATE';
              if (msg.includes('lego') || msg.includes('layer')) return 'LAYER';
              if (msg.includes('cover') || msg.includes('restyle')) return 'RESTYLE';
              return 'SESSION';
            };
            const visibleCommits = sortedCommits;
            const resolvedSelectedCommitId =
              selectedCommitId && visibleCommits.some((c) => c.id === selectedCommitId)
                ? selectedCommitId
                : visibleCommits[visibleCommits.length - 1]?.id || null;

            return (
              <div className="toolbox-history-panel">
                <div className="toolbox-history-toolbar">
                  <div className="toolbox-history-tabs">
                    <button
                      type="button"
                      className={`toolbox-mode-btn ${historyTab === 'takes' ? 'active' : ''}`}
                      onClick={() => setHistoryTab('takes')}
                    >
                      TAKES ({takes.length})
                    </button>
                    <button
                      type="button"
                      className={`toolbox-mode-btn ${historyTab === 'commits' ? 'active' : ''}`}
                      onClick={() => setHistoryTab('commits')}
                    >
                      COMMITS ({commits.length})
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btn-base btn-variant-primary btn-size-xs"
                    onClick={onOpenCommitModal}
                  >
                    COMMIT
                  </button>
                </div>

                {historyTab === 'takes' ? (
                  <div className="toolbox-takes-section">
                    {takes.length === 0 ? (
                      <p className="toolbox-history-empty">No takes in session yet.</p>
                    ) : (
                      <div className="toolbox-takes-list">
                        {visibleTakes.map((take, idx) => {
                          const isSelected =
                            selectedTrackId === take.id ||
                            (!takes.some((t) => t.id === selectedTrackId) && visibleTakes[0]?.id === take.id);
                          const active = mounted(take, tracks, takes);
                          return (
                            <div
                              key={take.id}
                              className={`toolbox-take-item ${active ? 'active' : ''} ${isSelected ? 'selected' : 'folded'}`}
                              onClick={() => {
                                if (onSelectTrack) onSelectTrack(take.id);
                                useDawStore.getState().setSelectedTrackId(take.id);
                              }}
                            >
                              <div className="toolbox-take-meta">
                                <span className="toolbox-take-num">#{take.take_number ?? idx + 1}</span>
                                <span className="toolbox-take-task">{taskLabel(take.task)}</span>
                                {take.repainting_start != null && take.repainting_end != null && (
                                  <span className="toolbox-take-range">
                                    [{formatTime(take.repainting_start)}➔{formatTime(take.repainting_end)}]
                                  </span>
                                )}
                              </div>
                              {isSelected && (
                                <div className="toolbox-take-actions">
                                  <button
                                    type="button"
                                    className="btn-base btn-variant-ghost btn-size-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isSelected && isPlaying) {
                                        dawEngine.stopAuditionTake();
                                        setPlaying(false);
                                      } else {
                                        if (onSelectTrack) onSelectTrack(take.id);
                                      }
                                    }}
                                  >
                                    {isSelected && isPlaying ? 'STOP' : 'PLAY'}
                                  </button>
                                  <button
                                    type="button"
                                    title={active ? 'Unmount take' : 'Mount take as base'}
                                    aria-pressed={active}
                                    className={`btn-base ${active ? 'btn-variant-primary' : 'btn-variant-ghost'} btn-size-xs`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleTake(take.id);
                                    }}
                                  >
                                    {active ? 'BASE' : 'MOUNT'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-base btn-variant-ghost btn-size-xs toolbox-take-delete-btn"
                                    title="Delete take"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteTake(take.id);
                                    }}
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="toolbox-commits-section">
                    {commits.length === 0 ? (
                      <p className="toolbox-history-empty">No commits yet.</p>
                    ) : (
                      <div className="toolbox-commits-list">
                        {visibleCommits.map((c) => {
                          const isSelected = resolvedSelectedCommitId === c.id;
                          const chronoNum = commitChronoNumMap.get(c.id) ?? 1;
                          const snapTakeId = c.timeline_snapshot?.activeTakeId
                            ? String(c.timeline_snapshot.activeTakeId)
                            : null;
                          return (
                            <div
                              key={c.id}
                              className={`toolbox-commit-item ${isSelected ? 'selected' : 'folded'}`}
                              onClick={() => setSelectedCommitId(c.id)}
                            >
                              <div className="toolbox-commit-meta">
                                <span className="toolbox-commit-badge">#{chronoNum}</span>
                                <span className="toolbox-commit-cat-tag">{getCommitCat(c)}</span>
                                <span className="toolbox-commit-msg">{c.message}</span>
                                <span className="toolbox-commit-time">
                                  {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              {isSelected && (
                                <div className="toolbox-commit-actions">
                                  {snapTakeId && (
                                    <button
                                      type="button"
                                      className="btn-base btn-variant-ghost btn-size-xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (onSelectTrack) onSelectTrack(snapTakeId);
                                        useDawStore.getState().setSelectedTrackId(snapTakeId);
                                      }}
                                    >
                                      AUDITION
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="btn-base btn-variant-primary btn-size-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (Array.isArray(c.timeline_snapshot?.tracks)) {
                                        useDawStore.getState().restoreSession([c]);
                                        toast.success(`Restored commit: ${c.message}`);
                                      } else if (snapTakeId) {
                                        void toggleTake(snapTakeId);
                                      } else {
                                        toast.success(`Selected commit: ${c.message}`);
                                      }
                                    }}
                                  >
                                    RESTORE
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Bottom Dock: [MRU - PREVIEW] | [TOOL ICON] | [TOOL ICON] | [TOOL ICON] | [+N] */}
        <div className="toolbox-bottom-dock" role="tablist" aria-label="Manual Tool Selector">
          {/* 1. [MRU - PREVIEW] — Live Graphical Preview of Previous Manual Tool for 1-Tap Swap */}
          <Tooltip
            title={`Swap to ${mruToolDef.label}`}
            description={`${mruToolDef.desc}`}
          >
            <button
              type="button"
              className={`toolbox-mru-preview-btn ${mruToolDef.dirty ? 'is-dirty' : ''}`}
              onClick={() => handlePickTool(mruToolDef.id)}
              aria-label={`Switch to recent tool ${mruToolDef.label}`}
            >
              <div className="toolbox-mru-meta">
                <span className="toolbox-mru-label">{mruToolDef.label}</span>
                {mruToolDef.dirty && <span className="toolbox-tab-dirty-dot" aria-label="Modified" />}
              </div>
              <div className="toolbox-mru-graphic">
                <ToolMicroPreview toolId={mruToolDef.id} />
              </div>
            </button>
          </Tooltip>

          {/* 2. [TOOL ICON] x 3 — Direct Tool Buttons */}
          {primaryDockTools.map((tool) => {
            const Icon = tool.icon;
            const isActive = resolvedActiveTool === tool.id;
            return (
              <Tooltip key={tool.id} title={tool.label} description={tool.desc}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`toolbox-dock-tool-btn ${tool.className} ${isActive ? 'active' : ''} ${tool.dirty ? 'is-dirty' : ''}`}
                  onClick={() => handlePickTool(tool.id)}
                >
                  <Icon size={14} />
                  <span className="toolbox-dock-tool-label">{tool.label}</span>
                  {tool.dirty && <span className="toolbox-tab-dirty-dot" aria-label="Modified" />}
                </button>
              </Tooltip>
            );
          })}

          {/* 3. [+N] — Overflow Manual Tools Drawer with Live Graphical Previews */}
          <div className="toolbox-overflow-wrap" ref={overflowRef}>
            <Tooltip
              title="More Tools"
              description={overflowDockTools.map((t) => t.label).join(' • ')}
            >
              <button
                type="button"
                className={`toolbox-dock-more-btn ${isOverflowToolActive ? 'active' : ''} ${isOverflowOpen ? 'open' : ''}`}
                aria-expanded={isOverflowOpen}
                aria-label={`More manual tools (+${overflowDockTools.length})`}
                onClick={() => setIsOverflowOpen((prev) => !prev)}
              >
                <span className="toolbox-more-count">+{overflowDockTools.length}</span>
                {isOverflowToolActive && (
                  <span className="toolbox-more-active-tag">{activeToolDef.label}</span>
                )}
              </button>
            </Tooltip>

            {isOverflowOpen && (
              <div className="toolbox-overflow-popover" role="menu" aria-label="Additional Manual Tools">
                {overflowDockTools.map((tool) => {
                  const Icon = tool.icon;
                  const isActive = resolvedActiveTool === tool.id;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      role="menuitem"
                      className={`toolbox-overflow-item ${isActive ? 'active' : ''}`}
                      onClick={() => handlePickTool(tool.id)}
                    >
                      <div className="toolbox-overflow-item-head">
                        <Icon size={13} />
                        <span className="toolbox-overflow-item-label">{tool.label}</span>
                        <span className="toolbox-overflow-item-meta">{tool.meta}</span>
                        {tool.dirty && <span className="toolbox-tab-dirty-dot" />}
                      </div>
                      <div className="toolbox-overflow-item-preview">
                        <ToolMicroPreview toolId={tool.id} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
