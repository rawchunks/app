import React, { useState, useRef, useEffect } from 'react';
import { Modal } from '../modal';
import { Button } from '../button';
import { Badge } from '../badge';
import { Tooltip } from '../daw/Tooltip';
import { api } from '@/lib/api';
import { store } from '@/lib/store';
import { openGate } from '@/lib/gate';
import {
  createAlbumApi,
  updateAlbumApi,
  addSongToAlbumApi,
  removeSongFromAlbumApi,
} from '@/hooks/use-albums';
import type { Album, Song, AlbumReleaseConfig } from '@/lib/schema';
import { toast } from 'sonner';
import {
  Upload,
  Sparkles,
  Disc3,
  Music,
} from 'lucide-react';

export interface AlbumModalProps {
  isOpen: boolean;
  onClose: () => void;
  album: Album | null;
  activeAddress?: string | null;
  songs: Song[];
  onSaved: () => void;
}

const ALBUM_GENRES = [
  'ELECTRONIC',
  'ACID TECHNO',
  'CYBERPUNK',
  'SYNTHWAVE',
  'AMBIENT',
  'DNB',
  'HOUSE',
  'INDUSTRIAL',
  'HIP HOP',
  'LO-FI',
  'ROCK',
  'CINEMATIC STRINGS',
  'NEURAL GLITCH',
];

export const AlbumModal: React.FC<AlbumModalProps> = ({
  isOpen,
  onClose,
  album,
  activeAddress,
  songs,
  onSaved,
}) => {
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('ELECTRONIC');
  const [description, setDescription] = useState('');
  const [concept, setConcept] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [targetNetwork, setTargetNetwork] = useState<'base' | 'tempo' | 'solana'>('base');
  const [bundlePrice, setBundlePrice] = useState('45');
  const [editionSize, setEditionSize] = useState('100');
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(new Set());

  const [albumTab, setAlbumTab] = useState<'details' | 'tracks'>('details');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [saving, setSaving] = useState(false);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setAlbumTab('details');
    if (album) {
      setTitle(album.title || '');
      setGenre(album.genre ? album.genre.toUpperCase() : 'ELECTRONIC');
      setDescription(album.description || '');
      setConcept(album.concept || '');
      setCover(album.cover && album.cover.trim() !== '' ? album.cover : null);
      setGallery(Array.isArray(album.gallery) ? album.gallery : []);
      setIsPublic(Boolean(album.public));
      const rc = album.release_config;
      const net = rc?.network?.toLowerCase() || '';
      setTargetNetwork(
        net.includes('solana') ? 'solana' : net.includes('tempo') || net.includes('42') ? 'tempo' : 'base'
      );
      setBundlePrice(rc?.bundle_price != null ? String(rc.bundle_price) : '45');
      setEditionSize(rc?.edition_size != null ? String(rc.edition_size) : '100');
      const assigned = new Set(
        songs.filter((s) => s.album_id === album.id).map((s) => s.id)
      );
      setSelectedSongIds(assigned);
    } else {
      setTitle('');
      setGenre('ELECTRONIC');
      setDescription('');
      setConcept('');
      setCover(null);
      setGallery([]);
      setSelectedSongIds(new Set());
    }
  }, [isOpen, album, songs]);

  const handleUploadImage = async (
    file: File,
    onResult: (url: string) => void,
    setBusy: (v: boolean) => void
  ) => {
    setBusy(true);
    try {
      const data = new FormData();
      data.append('file', file);
      const res = await api.fetch('/api/generation/cover', {
        method: 'POST',
        body: data,
      });
      const result = await res.json();
      if (!res.ok || !result.imageUrl) {
        throw new Error(result.error || 'Could not upload artwork');
      }
      onResult(result.imageUrl);
      toast.success('Artwork uploaded');
    } catch (err: any) {
      toast.error(err.message || 'Artwork upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateCover = async (retry = false) => {
    if (!(await openGate({ steps: ['login', 'funding'] }))) return;
    setGeneratingCover(true);
    try {
      const promptParts = [
        title.trim() || 'futuristic album sleeve',
        `${genre} music album cover`,
        concept.trim() ? concept.trim().slice(0, 140) : description.trim().slice(0, 120),
        'iconic vinyl sleeve artwork, high contrast dark aesthetic',
      ].filter(Boolean);
      const res = await api.fetch('/api/generation/cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptParts.join(', '),
          title: title.trim() || undefined,
          style: genre || undefined,
        }),
      });
      if (res.status === 402) {
        void openGate({ steps: ['login', 'funding'], reason: 'Session budget exhausted' }).then(
          (ready) => {
            if (ready && !retry) void handleGenerateCover(true);
          }
        );
        return;
      }
      const result = await res.json();
      if (!res.ok || !result.imageUrl) {
        throw new Error(result.error || 'Could not generate album cover');
      }
      setCover(result.imageUrl);
      toast.success('Album cover generated');
    } catch (err: any) {
      toast.error(err.message || 'Album cover generation failed');
    } finally {
      setGeneratingCover(false);
    }
  };

  const toggleTrackSelection = (songId: string) => {
    setSelectedSongIds((prev) => {
      const next = new Set(prev);
      if (next.has(songId)) next.delete(songId);
      else next.add(songId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!activeAddress) return;
    if (!title.trim()) {
      toast.error('Enter an album title');
      return;
    }

    setSaving(true);
    try {
      const parsedBundle = parseFloat(bundlePrice);
      const parsedEdition = parseInt(editionSize, 10);
      const releaseConfig: AlbumReleaseConfig = {
        ready: Boolean(title.trim() && cover && selectedSongIds.size > 0),
        network: targetNetwork,
        bundle_price: Number.isFinite(parsedBundle) && parsedBundle >= 0 ? parsedBundle : 45,
        edition_size: Number.isFinite(parsedEdition) && parsedEdition > 0 ? parsedEdition : 100,
      };

      let targetAlbum: Album;
      if (album) {
        targetAlbum = await updateAlbumApi(
          album.id,
          {
            title: title.trim(),
            genre: genre.trim(),
            description: description.trim(),
            concept: concept.trim(),
            cover: cover || '',
            gallery,
            release_config: releaseConfig,
            public: isPublic,
          },
          activeAddress
        );
      } else {
        targetAlbum = await createAlbumApi(
          {
            title: title.trim(),
            creator: activeAddress,
            genre: genre.trim(),
            description: description.trim(),
            concept: concept.trim(),
            cover: cover || '',
            gallery,
            release_config: releaseConfig,
            public: isPublic,
          },
          activeAddress
        );
      }

      // Sync track memberships
      const currentAssigned = new Set(
        songs.filter((s) => s.album_id === targetAlbum.id).map((s) => s.id)
      );

      for (const songId of selectedSongIds) {
        if (!currentAssigned.has(songId)) {
          const songObj = songs.find((s) => s.id === songId);
          if (songObj?.album_id && songObj.album_id !== targetAlbum.id) {
            await removeSongFromAlbumApi(songObj.album_id, songId, activeAddress);
          }
          await addSongToAlbumApi(targetAlbum.id, songId, activeAddress);
          store.updateSong(songId, {
            album_id: targetAlbum.id,
            album_title: targetAlbum.title,
          });
        } else {
          store.updateSong(songId, {
            album_title: targetAlbum.title,
          });
        }
      }

      for (const oldSongId of currentAssigned) {
        if (!selectedSongIds.has(oldSongId)) {
          await removeSongFromAlbumApi(targetAlbum.id, oldSongId, activeAddress);
          store.updateSong(oldSongId, { album_id: null, album_title: null });
        }
      }

      onSaved();
      toast.success(album ? 'Album updated' : 'Album created');
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Could not save album');
    } finally {
      setSaving(false);
    }
  };

  const creatorTracks = songs.filter((s) => !s.is_remix && !s.source);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={album ? 'EDIT ALBUM' : 'NEW ALBUM'}
      size="md"
    >
      <div className="studio-param-modal-content">
        <input
          type="file"
          ref={coverInputRef}
          accept="image/*"
          className="hidden-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void handleUploadImage(file, setCover, setUploadingCover);
            }
            if (coverInputRef.current) coverInputRef.current.value = '';
          }}
        />
        <input
          type="file"
          ref={galleryInputRef}
          accept="image/*"
          className="hidden-file-input"
        />

        {/* Studio-style Mode Switcher Tabs */}
        <div className="studio-voice-mode-switch">
          <button
            type="button"
            className={`studio-voice-mode-btn ${albumTab === 'details' ? 'active' : ''}`}
            onClick={() => setAlbumTab('details')}
          >
            <Disc3 size={13} />
            <span>DETAILS</span>
          </button>
          <button
            type="button"
            className={`studio-voice-mode-btn ${albumTab === 'tracks' ? 'active' : ''}`}
            onClick={() => setAlbumTab('tracks')}
          >
            <Music size={13} />
            <span>TRACKS</span>
            <span className="studio-voice-count-badge">{selectedSongIds.size}</span>
          </button>
        </div>

        {/* Tab 1: Album Details */}
        {albumTab === 'details' && (
          <div className="edit-song-content">
            <div className="cyber-input-wrap">
              <label className="cyber-input-label">ALBUM TITLE</label>
              <input
                type="text"
                className="cyber-input-field"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="ENTER ALBUM TITLE..."
                maxLength={80}
              />
            </div>

            <div className="edit-song-2col-row">
              <div className="cyber-input-wrap">
                <label className="cyber-input-label">PRIMARY GENRE</label>
                <select
                  className="cyber-input-field"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                >
                  {ALBUM_GENRES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="cyber-input-wrap">
              <label className="cyber-input-label">COVER ARTWORK</label>
              <div className="edit-song-cover-row">
                <div className={`studio-avatar-box ${cover ? 'has-image' : ''}`}>
                  {cover ? (
                    <>
                      <img
                        src={cover}
                        alt="Album cover"
                        className="studio-avatar-preview"
                        onClick={() => coverInputRef.current?.click()}
                      />
                      <Tooltip title="Remove cover" className="studio-avatar-remove-wrap">
                        <button
                          type="button"
                          className="studio-avatar-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCover(null);
                          }}
                        >
                          ✕
                        </button>
                      </Tooltip>
                    </>
                  ) : (
                    <div
                      className="studio-avatar-upload-trigger"
                      onClick={() => coverInputRef.current?.click()}
                    >
                      <span className="studio-avatar-upload-icon">
                        <Upload size={22} strokeWidth={2} />
                      </span>
                      <span className="studio-avatar-label">
                        {uploadingCover ? 'UPLOADING...' : 'PICK IMAGE'}
                      </span>
                    </div>
                  )}
                </div>

                <div className="edit-song-cover-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleGenerateCover()}
                    disabled={generatingCover || uploadingCover}
                  >
                    <Sparkles size={12} />
                    {generatingCover ? 'GENERATING…' : 'GENERATE AI COVER'}
                  </Button>
                  <div className="edit-song-cover-hint">
                    Upload custom artwork or generate sleeve cover from title &amp; concept.
                  </div>
                </div>
              </div>
            </div>

            <div className="cyber-input-wrap">
              <label className="cyber-input-label">CONCEPT &amp; LINER NOTES</label>
              <textarea
                className="cyber-input-field album-concept-textarea"
                rows={2}
                value={concept}
                onChange={(e) => {
                  setConcept(e.target.value);
                  if (!description) setDescription(e.target.value.slice(0, 140));
                }}
                placeholder="Describe sonic direction, narrative, credits, or liner notes..."
                maxLength={600}
              />
            </div>

          </div>
        )}

        {/* Tab 2: Tracklist Selection */}
        {albumTab === 'tracks' && (
          <>
            {creatorTracks.length === 0 ? (
              <div className="studio-voice-empty-state">
                <Music size={24} className="studio-voice-empty-icon" />
                <span className="studio-voice-empty-title">NO TRACKS AVAILABLE</span>
                <span className="studio-voice-empty-desc">
                  Generate songs in Studio first to include them in this album.
                </span>
              </div>
            ) : (
              <div className="studio-voice-list">
                {creatorTracks.map((s) => {
                  const isSelected = selectedSongIds.has(s.id);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      className={`studio-voice-card ${isSelected ? 'active' : ''}`}
                      onClick={() => toggleTrackSelection(s.id)}
                    >
                      <div className="studio-voice-card-header">
                        <div className="studio-voice-card-title-wrap">
                          <Music size={13} className="studio-voice-card-icon" />
                          <span className="studio-voice-card-name">{s.title}</span>
                        </div>
                        <div className="studio-voice-card-badges">
                          {s.public && <Badge variant="primary">LIVE</Badge>}
                          {isSelected && <span className="studio-voice-card-check">✓</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="studio-voice-active-strip">
              <div className="studio-field-label studio-field-label-flush">
                <span>SELECTED TRACKS</span>
                <span className="studio-highlight">{selectedSongIds.size}</span>
              </div>
              {selectedSongIds.size > 0 && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setSelectedSongIds(new Set())}
                >
                  CLEAR
                </Button>
              )}
            </div>
          </>
        )}

        <div className="studio-param-actions-row">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            CANCEL
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'SAVING…' : album ? 'SAVE ALBUM' : 'CREATE ALBUM'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
