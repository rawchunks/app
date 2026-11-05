import React, { useState, useRef, useEffect } from 'react';
import { Modal } from './modal';
import { Button } from './button';
import { api } from '@/lib/api';
import { store } from '@/lib/store';
import { Song, Album } from '@/lib/schema';
import { addSongToAlbumApi, removeSongFromAlbumApi } from '@/hooks/use-albums';
import { useOptions, type TagCategory } from '@/hooks/use-options';
import { openGate } from '@/lib/gate';
import { toast } from 'sonner';
import { Upload, Sparkles } from 'lucide-react';
import { Tooltip } from './daw/Tooltip';

export function resolveCanonicalGenres(raw: string[], categories: TagCategory[]): string[] {
  const canonicalByLower = new Map<string, string>();
  for (const cat of categories) {
    for (const tag of cat.tags) {
      canonicalByLower.set(tag.id.toLowerCase(), tag.id);
      canonicalByLower.set(tag.label.toLowerCase(), tag.id);
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    for (const part of String(item || '').split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const canonical = canonicalByLower.get(trimmed.toLowerCase()) ?? trimmed;
      const key = canonical.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(canonical);
      }
    }
  }
  return out;
}

export function formatTagSummary(tags: string[]): string {
  if (tags.length === 0) return 'NONE';
  const upper = tags.map((t) => t.toUpperCase());
  if (upper.length <= 2) return upper.join(' · ');
  return `${upper.slice(0, 2).join(' · ')} +${upper.length - 2}`;
}

export interface GenresModalProps {
  isOpen: boolean;
  onClose: () => void;
  selected: string[];
  onChange: React.Dispatch<React.SetStateAction<string[]>>;
  categories?: TagCategory[];
  title?: string;
  maxTotal?: number;
  isSegmented?: boolean;
  guideOwner?: string;
  guideAnchor?: string;
}

export const GenresModal: React.FC<GenresModalProps> = ({
  isOpen,
  onClose,
  selected,
  onChange,
  categories: categoriesProp,
  title,
  maxTotal = 3,
  isSegmented = false,
  guideOwner = 'studio',
  guideAnchor = 'studio.tags-editor',
}) => {
  const { data: optionsData } = useOptions();
  const categories = categoriesProp ?? optionsData?.generation?.genres ?? [];
  const [expandedTagCategory, setExpandedTagCategory] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setExpandedTagCategory(null);
    }
  }, [isOpen]);

  const expandedCategory = categories.find((c) => c.id === expandedTagCategory) ?? null;

  const findTagMeta = (tagId: string) => {
    const lower = tagId.toLowerCase();
    for (const cat of categories) {
      const found = cat.tags.find((t) => t.id.toLowerCase() === lower || t.label.toLowerCase() === lower);
      if (found) return found;
    }
    return { id: tagId, label: tagId, desc: '' };
  };

  const toggleMultiTag = (tagId: string) => {
    onChange((current) => {
      const lower = tagId.toLowerCase();
      const exists = current.some((t) => t.toLowerCase() === lower);
      if (exists) {
        return current.filter((t) => t.toLowerCase() !== lower);
      }
      if (current.length < maxTotal) {
        return [...current, tagId];
      }
      return [...current.slice(1), tagId];
    });
  };

  const toggleSegmentedTag = (tagId: string, category: TagCategory) => {
    onChange((current) => {
      const lower = tagId.toLowerCase();
      if (current.some((t) => t.toLowerCase() === lower)) {
        return current.filter((t) => t.toLowerCase() !== lower);
      }
      const categoryTagIds = new Set(category.tags.map((t) => t.id.toLowerCase()));
      const withoutThisCategory = current.filter((t) => !categoryTagIds.has(t.toLowerCase()));
      return [...withoutThisCategory, tagId];
    });
  };

  return (
    <Modal
      guideOwner={guideOwner}
      guideAnchor={guideAnchor}
      isOpen={isOpen}
      onClose={() => {
        onClose();
        setExpandedTagCategory(null);
      }}
      title={title ?? `GENRES (${selected.length}/${maxTotal})`}
      size="md"
    >
      <div className="studio-param-modal-content studio-tags-expanding-modal">
        <div
          className={`studio-tags-core-tabs ${
            categories.length === 4
              ? 'cols-4'
              : categories.length === 6
                ? 'cols-3'
                : 'cols-wrap'
          }`}
        >
          {categories.map((cat) => {
            const isExpanded = expandedTagCategory === cat.id;
            const selectedInCat = cat.tags.filter((t) =>
              selected.some((s) => s.toLowerCase() === t.id.toLowerCase())
            );
            const hasSelection = selectedInCat.length > 0;
            return (
              <Tooltip key={cat.id} title={cat.desc}>
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  className={`studio-tags-core-pill ${isExpanded ? 'expanded' : ''} ${hasSelection ? 'has-selection' : ''}`}
                  onClick={() => setExpandedTagCategory(isExpanded ? null : cat.id)}
                >
                  <span className="studio-tags-core-title">{cat.label.toUpperCase()}</span>
                  {hasSelection && (
                    <span className="studio-tags-core-badge">{selectedInCat.length}</span>
                  )}
                  <span className="studio-tags-core-chevron">{isExpanded ? '▲' : '▼'}</span>
                </button>
              </Tooltip>
            );
          })}
        </div>

        {expandedCategory && (
          <div className="studio-tags-sub-grid">
            {expandedCategory.tags.map((tag) => {
              const isSelected = selected.some((s) => s.toLowerCase() === tag.id.toLowerCase());
              return (
                <Tooltip key={tag.id} title={tag.desc}>
                  <button
                    type="button"
                    className={`studio-tags-sub-chip ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      if (isSegmented) {
                        toggleSegmentedTag(tag.id, expandedCategory);
                      } else {
                        toggleMultiTag(tag.id);
                      }
                    }}
                  >
                    <span className="studio-tags-sub-chip-label">{tag.label.toUpperCase()}</span>
                    {isSelected && <span className="studio-tags-sub-chip-check">✓</span>}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}

        {selected.length > 0 && (
          <div className="studio-tags-selected-badges">
            {selected.map((tagId) => {
              const meta = findTagMeta(tagId);
              return (
                <Tooltip key={tagId} title={meta.desc || 'Click to remove'}>
                  <button
                    type="button"
                    className="studio-tags-active-pill"
                    onClick={() =>
                      onChange((prev) => prev.filter((t) => t.toLowerCase() !== tagId.toLowerCase()))
                    }
                  >
                    <span>{meta.label.toUpperCase()}</span>
                    <span className="studio-tags-active-pill-x">✕</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}

        <div className="studio-param-actions-row">
          <Button
            variant="ghost"
            size="sm"
            disabled={selected.length === 0}
            onClick={() => onChange([])}
          >
            CLEAR
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onClose();
              setExpandedTagCategory(null);
            }}
          >
            DONE
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export interface EditSongModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: Song | null;
  activeAddress?: string | null;
  albums?: Album[];
  onAlbumsChanged?: () => void;
}

const GENRES = [
  'Acid Techno',
  'Airy Lead Vocals',
  'Ambient',
  'Breakcore',
  'Cinematic Strings',
  'Crisp Acoustic Drums',
  'Cyberpunk',
  'DNB',
  'Electro',
  'Electronic',
  'Funky Electric Guitar',
  'Glitch',
  'Hardcore',
  'Hip Hop',
  'House',
  'Industrial',
  'Lo-Fi',
  'Lo-Fi Tape Saturation',
  'Lush Backing Harmonies',
  'Neural Glitch',
  'Punchy 808 Bass',
  'Rock',
  'Synthwave',
  'Techno',
  'Trance',
  'Warm Analog Synth',
];

export const EditSongModal: React.FC<EditSongModalProps> = ({
  isOpen,
  onClose,
  song,
  activeAddress,
  albums = [],
  onAlbumsChanged,
}) => {
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('ELECTRONIC');
  const [albumId, setAlbumId] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [streamPrice, setStreamPrice] = useState('0.05');
  const [licenses, setLicenses] = useState('50');
  const [licensePrice, setLicensePrice] = useState('20');
  const [uploading, setUploading] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && song) {
      setTitle(song.title || '');
      setGenre(song.tags?.[0] ? song.tags[0].toUpperCase() : 'ELECTRONIC');
      setAlbumId(song.album_id || '');
      setImage(song.image ? song.image : null);
      setStreamPrice(String(song.stream_price ?? 0.05));
      setLicenses(String(song.licenses ?? 50));
      setLicensePrice(String(song.license_price ?? 20));
    }
  }, [isOpen, song]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const data = new FormData();
      data.append('file', file);
      const res = await api.fetch('/api/generation/cover', {
        method: 'POST',
        body: data,
      });
      const result = await res.json();
      if (!res.ok || !result.imageUrl) {
        throw new Error(result.error || 'Failed to upload cover art');
      }
      setImage(result.imageUrl);
      toast.success('Cover image uploaded');
    } catch (err: any) {
      toast.error(err.message || 'Cover upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleGenerateCover = async (retry = false) => {
    if (!await openGate({ steps: ['login', 'funding'] })) return;
    setGeneratingCover(true);
    try {
      const res = await api.fetch('/api/generation/cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `${title.trim() || 'futuristic soundscape'}, ${genre} music style, cyberpunk dark aesthetic artwork`,
          title: title.trim() || undefined,
          style: genre || undefined,
        }),
      });
      if (res.status === 402) {
        void openGate({ steps: ['login', 'funding'], reason: 'Session budget exhausted' })
          .then(ready => { if (ready && !retry) void handleGenerateCover(true); });
        return;
      }
      const result = await res.json();
      if (!res.ok || !result.imageUrl) {
        throw new Error(result.error || 'Failed to generate cover');
      }
      setImage(result.imageUrl);
      toast.success('AI cover generated');
    } catch (err: any) {
      toast.error(err.message || 'Cover generation failed');
    } finally {
      setGeneratingCover(false);
    }
  };

  const handleSave = async () => {
    if (!song) return;
    if (!title.trim()) {
      toast.error('Song title cannot be empty');
      return;
    }
    const sPrice = parseFloat(streamPrice);
    if (isNaN(sPrice) || sPrice < 0) {
      toast.error('Invalid stream price');
      return;
    }
    const isRemix = Boolean(song.source || song.is_remix);
    const lCount = parseInt(licenses, 10);
    const lPrice = parseFloat(licensePrice);
    if (!song.public && !isRemix) {
      if (isNaN(lCount) || lCount < 0) {
        toast.error('Invalid license count');
        return;
      }
      if (isNaN(lPrice) || lPrice < 0) {
        toast.error('Invalid license price');
        return;
      }
    }

    setSaving(true);
    try {
      const patchPayload: Record<string, any> = {
        title: title.trim(),
        tags: genre ? [genre.toUpperCase()] : song.tags,
        image: image || null,
        stream_price: sPrice,
      };
      if (!song.public && !isRemix) {
        patchPayload.licenses = lCount;
        patchPayload.license_price = lPrice;
      }

      const res = await api.fetch(`/api/songs/${encodeURIComponent(song.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        userAddress: activeAddress ?? undefined,
        body: JSON.stringify(patchPayload),
      });

      const updated = await res.json();
      if (!res.ok) {
        throw new Error(updated.error || 'Failed to update song details');
      }

      const prevAlbumId = song.album_id || '';
      if (albumId !== prevAlbumId) {
        if (prevAlbumId) {
          await removeSongFromAlbumApi(prevAlbumId, song.id, activeAddress ?? undefined);
        }
        if (albumId) {
          await addSongToAlbumApi(albumId, song.id, activeAddress ?? undefined);
        }
        onAlbumsChanged?.();
      }
      const nextAlbum = albums.find((a) => a.id === albumId);

      store.updateSong(song.id, {
        title: title.trim(),
        tags: patchPayload.tags,
        image: patchPayload.image,
        stream_price: sPrice,
        album_id: albumId || null,
        album_title: nextAlbum ? nextAlbum.title : null,
        ...(!song.public && !isRemix ? { licenses: lCount, license_price: lPrice } : {}),
      });

      toast.success('Song details updated');
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update song');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal guideOwner="song-details" guideAnchor="song-details.form" guideDraft guideEntity={song?.id} isOpen={isOpen} onClose={onClose} title="EDIT SONG DETAILS" size="md">
      <div className="edit-song-content">
        {/* Title Field */}
        <div className="cyber-input-wrap">
          <label className="cyber-input-label">TRACK TITLE</label>
          <input
            type="text"
            className="cyber-input-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ENTER TITLE..."
            maxLength={60}
          />
        </div>

        {/* Genre & Album Dropdowns */}
        <div className="edit-song-2col-row">
          <div className="cyber-input-wrap">
            <label className="cyber-input-label">GENRE</label>
            <select
              className="cyber-input-field"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
            >
              {GENRES.map((g) => (
                <option key={g} value={g.toUpperCase()}>
                  {g.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="cyber-input-wrap">
            <label className="cyber-input-label">ALBUM</label>
            <select
              className="cyber-input-field"
              value={albumId}
              onChange={(e) => setAlbumId(e.target.value)}
            >
              <option value="">SINGLE (NO ALBUM)</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Cover Art Box with Pick Image & Generate Button */}
        <div className="cyber-input-wrap">
          <label className="cyber-input-label">COVER ARTWORK</label>
          <div className="edit-song-cover-row">
            <div className={`studio-avatar-box ${image ? 'has-image' : ''}`}>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                className="hidden-file-input"
                onChange={handleFileUpload}
              />
              {image ? (
                <>
                  <img
                    src={image}
                    alt="Song cover preview"
                    className="studio-avatar-preview"
                    onClick={() => fileInputRef.current?.click()}
                  />
                  <Tooltip title="Remove cover" className="studio-avatar-remove-wrap">
                    <button
                      type="button"
                      className="studio-avatar-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        setImage(null);
                      }}
                    >
                      ✕
                    </button>
                  </Tooltip>
                </>
              ) : (
                <div
                  className="studio-avatar-upload-trigger"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="studio-avatar-upload-icon">
                    <Upload size={22} strokeWidth={2} />
                  </span>
                  <span className="studio-avatar-label">
                    {uploading ? 'UPLOADING...' : 'PICK IMAGE'}
                  </span>
                </div>
              )}
            </div>

            <div className="edit-song-cover-actions">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleGenerateCover()}
                disabled={generatingCover || uploading}
              >
                <Sparkles size={12} />
                {generatingCover ? 'GENERATING…' : 'GENERATE AI COVER'}
              </Button>
              <div className="edit-song-cover-hint">
                Upload custom image or generate cyber artwork from title & genre.
              </div>
            </div>
          </div>
        </div>

        {/* Pricing & Licensing Fields */}
        <div className="cyber-input-wrap">
          <label className="cyber-input-label">STREAM PRICE ($/MIN)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="cyber-input-field"
            value={streamPrice}
            onChange={(e) => setStreamPrice(e.target.value)}
          />
        </div>

        <div className="edit-song-2col-row">
          <div className="cyber-input-wrap">
            <label className="cyber-input-label">TOTAL LICENSES</label>
            <input
              type="number"
              step="1"
              min="1"
              className="cyber-input-field"
              value={licenses}
              onChange={(e) => setLicenses(e.target.value)}
              disabled={Boolean(song?.public)}
            />
            {song?.public && (
              <div className="edit-song-field-hint">Locked on-chain</div>
            )}
          </div>

          <div className="cyber-input-wrap">
            <label className="cyber-input-label">LICENSE PRICE ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="cyber-input-field"
              value={licensePrice}
              onChange={(e) => setLicensePrice(e.target.value)}
              disabled={Boolean(song?.public)}
            />
            {song?.public && (
              <div className="edit-song-field-hint">Locked on-chain</div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="publish-actions">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            CANCEL
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'SAVING…' : 'SAVE DETAILS'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
