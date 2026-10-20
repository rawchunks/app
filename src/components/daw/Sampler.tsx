import React, { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { useDawStore, DAWClip } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { decodeAudioFile, extractPeaksFromBuffer } from '../../lib/daw/peaks';
import { sdk } from '../../lib/sdk';
import { Button } from '../button';
import { Tooltip } from './Tooltip';
import { Upload, Play, Pause, Plus, Mic, Square, RefreshCw } from 'lucide-react';

interface SamplerProps {
  onImportComplete?: (trackId: string) => void;
}

export const Sampler: React.FC<SamplerProps> = ({ onImportComplete }) => {
  const { songId, addTrack, addClip, isPlaying } = useDawStore();
  const [isDragging, setIsDragging] = useState(false);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [fileUrl, setFileUrl] = useState<string>('');
  const [peaks, setPeaks] = useState<number[]>([]);
  const [numSlices, setNumSlices] = useState<number>(4);
  const [activeSlice, setActiveSlice] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [importing, setImporting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const handleFileProcess = async (file: File | Blob, customName?: string) => {
    dawEngine.stopAuditionTake();
    setPreviewing(false);
    setActiveSlice(null);
    setAudioBuffer(null);
    setPeaks([]);
    const name = customName || (file instanceof File ? file.name : `sample-${Date.now()}.wav`);
    setFileName(name);
    const objectUrl = URL.createObjectURL(file);
    setFileUrl(objectUrl);

    try {
      const decoded = await decodeAudioFile(file);
      const generatedPeaks = extractPeaksFromBuffer(decoded, 120);
      setAudioBuffer(decoded);
      setPeaks(generatedPeaks);
    } catch (err) {
      console.error('Audio decode error:', err);
      toast.error('Failed to decode audio data');
    }
  };

  const handleToggleVoiceRecord = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunksRef.current = [];
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
          stream.getTracks().forEach((track) => track.stop());
          handleFileProcess(audioBlob, `Voice Sample ${new Date().toLocaleTimeString()}`);
          toast.success('Voice sample captured successfully!');
        };

        mediaRecorder.start();
        setIsRecording(true);
        toast.info('Recording voice sample... Click stop when finished.');
      } catch (err: any) {
        console.error('Microphone error:', err);
        toast.error(err.message || 'Microphone access denied or unavailable');
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handlePreviewSample = async (sliceIdx?: number) => {
    if (!fileUrl || !audioBuffer) return;
    if (sliceIdx === undefined && previewing && isPlaying) {
      dawEngine.stopAuditionTake();
      setPreviewing(false);
      return;
    }
    setActiveSlice(sliceIdx ?? null);
    const start = sliceIdx === undefined ? 0 : sliceIdx * audioBuffer.duration / numSlices;
    const end = sliceIdx === undefined ? audioBuffer.duration : start + audioBuffer.duration / numSlices;
    dawEngine.auditionTake(fileUrl, start, end, 0);
    setPreviewing(true);
  };

  const handleImportToDaw = async () => {
    if (!audioBuffer || !fileUrl || importing) return;
    setImporting(true);
    try {
      const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index));
      const form = new FormData();
      form.append('file', dawEngine.encodeWavBlob(channels, audioBuffer.sampleRate, audioBuffer.length), 'sample.wav');
      const response = await sdk.fetch(`/api/editing/source?songId=${encodeURIComponent(songId)}`, { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || 'Could not save sample');
      const sliced = numSlices > 1 && activeSlice !== null;
      const offset = sliced ? activeSlice * audioBuffer.duration / numSlices : 0;
      const duration = sliced ? audioBuffer.duration / numSlices : audioBuffer.duration;
      const trackName = `SAMPLE: ${fileName.replace(/\.[^/.]+$/, '')}`;
      const newTrack = addTrack('sample', trackName);
      const clip: DAWClip = {
        id: `clip-${crypto.randomUUID()}`, name: sliced ? `${fileName} (Slice ${activeSlice + 1})` : fileName,
        url: result.url, startTime: 0, duration, offset,
        peaks: sliced ? peaks.slice(Math.floor(offset / audioBuffer.duration * peaks.length), Math.floor((offset + duration) / audioBuffer.duration * peaks.length)) : peaks,
      };
      addClip(newTrack.id, clip);
      await dawEngine.loadClip(newTrack.id, clip.id, result.url, 0, offset, duration);
      dawEngine.stopAuditionTake();
      setPreviewing(false);
      toast.success(`Imported sample into track "${trackName}"`);
      onImportComplete?.(newTrack.id);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not import sample'); }
    finally { setImporting(false); }
  };

  return (
    <div className="sample-importer-wrap">
      {/* Single-Row Command Bar */}
      <div className="sample-toolbar-row">
        {audioBuffer && (
          <div className="sample-file-meta">
            <span className="sample-file-name">
              {fileName} ({audioBuffer.duration.toFixed(1)}s)
            </span>
          </div>
        )}

        <div className="sample-header-actions">
          {audioBuffer && (
            <>
              <select
                className="toolbox-text-input toolbox-select-compact"
                aria-label="Slice count"
                value={numSlices}
                onChange={(e) => {
                  setNumSlices(parseInt(e.target.value, 10));
                  setActiveSlice(null);
                }}
              >
                {[2, 4, 8, 16].map((count) => (
                  <option key={count} value={count}>
                    {count} SLICES
                  </option>
                ))}
              </select>

              <Tooltip title={previewing && isPlaying ? 'Stop Preview' : 'Preview Sample'}>
                <Button size="sm" variant="outline" onClick={() => handlePreviewSample()}>
                  {previewing && isPlaying ? <Pause size={12} /> : <Play size={12} />}
                  <span className="daw-btn-label">PREVIEW</span>
                </Button>
              </Tooltip>

              <Tooltip title="Select a Different Audio File">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    dawEngine.stopAuditionTake();
                    setPreviewing(false);
                    setActiveSlice(null);
                    setAudioBuffer(null);
                    setPeaks([]);
                    setFileUrl('');
                  }}
                >
                  <RefreshCw size={12} />
                  <span className="daw-btn-label">REPLACE</span>
                </Button>
              </Tooltip>
            </>
          )}

          <Tooltip title={isRecording ? 'Stop Voice Recording' : 'Record Microphone Voice Sample'}>
            <Button
              size="sm"
              variant={isRecording ? 'destructive' : 'outline'}
              onClick={handleToggleVoiceRecord}
            >
              {isRecording ? <Square size={12} /> : <Mic size={12} color="#ff0055" />}
              <span className="daw-btn-label">{isRecording ? 'STOP' : 'RECORD'}</span>
            </Button>
          </Tooltip>

          {audioBuffer && (
            <Tooltip title="Import Sample into DAW Workstation">
              <Button size="sm" variant="default" onClick={handleImportToDaw} disabled={importing}>
                <Plus size={12} />
                <span className="daw-btn-label">IMPORT</span>
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {!audioBuffer ? (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`sample-dropzone ${isDragging ? 'active' : ''}`}
        >
          <Upload size={28} color={isDragging ? '#00ffff' : '#71717a'} className="sample-dropzone-icon" />
          <p className="sample-dropzone-title">
            Drag &amp; drop audio loops or samples here, or click to browse
          </p>
          <p className="sample-dropzone-sub">
            Supports WAV, MP3, FLAC, OGG • Or record microphone voice samples directly
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="sample-file-input"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileProcess(e.target.files[0]);
              }
            }}
          />
        </div>
      ) : (
        <div className="sample-active-container">
          <div className="sample-waveform-box">
            <div className="sample-waveform-inner">
              {peaks.map((peak, idx) => (
                <div
                  key={idx}
                  className="sample-peak-bar"
                  style={{ '--peak-h': `${Math.max(10, peak * 100)}%` } as React.CSSProperties}
                />
              ))}
            </div>

            {new Array(numSlices - 1).fill(0).map((_, i) => (
              <div
                key={i}
                className="sample-slice-marker"
                style={{ '--slice-left': `${((i + 1) / numSlices) * 100}%` } as React.CSSProperties}
              />
            ))}
          </div>

          <div className="sample-slices-grid">
            {new Array(numSlices).fill(0).map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handlePreviewSample(idx)}
                className={`sample-slice-btn ${activeSlice === idx ? 'active' : ''}`}
              >
                Slice {idx + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
