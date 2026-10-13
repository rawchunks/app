import React, { useState, useRef, useEffect } from 'react';
import { Modal } from './modal';
import { Button } from './button';
import { sdk } from '@/lib/sdk';
import { store } from '@/lib/store';
import { Song } from '@/lib/schema';
import { useSession, promptSessionModal } from '@/hooks/use-session';
import { toast } from 'sonner';
import { Upload, Sparkles } from 'lucide-react';

export interface EditSongModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: Song | null;
  activeAddress?: string | null;
}

const GENRES = [
  'Acid Techno',
  'Ambient',
  'Breakcore',
  'Cyberpunk',
  'DNB',
  'Electro',
  'Electronic',
  'Glitch',
  'Hardcore',
  'Hip Hop',
  'House',
  'Industrial',
  'Lo-Fi',
  'Rock',
  'Synthwave',
  'Techno',
  'Trance',
];

export const EditSongModal: React.FC<EditSongModalProps> = ({
  isOpen,
  onClose,
  song,
  activeAddress,
}) => {
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('ELECTRONIC');
  const [image, setImage] = useState<string | null>(null);
  const [streamPrice, setStreamPrice] = useState('0.05');
  const [licenses, setLicenses] = useState('50');
  const [licensePrice, setLicensePrice] = useState('20');
  const [uploading, setUploading] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const { session } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && song) {
      setTitle(song.title || '');
      setGenre(song.tags?.[0] ? song.tags[0].toUpperCase() : 'ELECTRONIC');
      setImage(song.image && song.image !== '/hero.png' ? song.image : null);
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
      const res = await sdk.fetch('/api/generation/cover', {
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

  const handleGenerateCover = async () => {
    if (!session.active) {
      toast.error('Active session required to generate cover. Please create a session.');
      promptSessionModal();
      return;
    }
    setGeneratingCover(true);
    try {
      const res = await sdk.fetch('/api/generation/cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `${title.trim() || 'futuristic soundscape'}, ${genre} music style, cyberpunk dark aesthetic artwork`,
          title: title.trim() || undefined,
          style: genre || undefined,
        }),
      });
      if (res.status === 402) {
        toast.error('Active session required or session budget exhausted. Please top up your session.');
        promptSessionModal();
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
    const lCount = parseInt(licenses, 10);
    const lPrice = parseFloat(licensePrice);
    if (!song.public) {
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
      if (!song.public) {
        patchPayload.licenses = lCount;
        patchPayload.license_price = lPrice;
      }

      const res = await sdk.fetch(`/api/songs/${encodeURIComponent(song.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        userAddress: activeAddress ?? undefined,
        body: JSON.stringify(patchPayload),
      });

      const updated = await res.json();
      if (!res.ok) {
        throw new Error(updated.error || 'Failed to update song details');
      }

      store.updateSong(song.id, {
        title: title.trim(),
        tags: patchPayload.tags,
        image: patchPayload.image,
        stream_price: sPrice,
        ...(!song.public ? { licenses: lCount, license_price: lPrice } : {}),
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
    <Modal isOpen={isOpen} onClose={onClose} title="EDIT SONG DETAILS" maxWidth="480px">
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

        {/* Genre Dropdown */}
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

        {/* Cover Art Box with Pick Image & Generate Button */}
        <div className="cyber-input-wrap">
          <label className="cyber-input-label">COVER ARTWORK</label>
          <div className="edit-song-cover-row">
            <div className={`studio-avatar-box ${image ? 'has-image' : ''}`}>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                style={{ display: 'none' }}
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
                  <button
                    type="button"
                    className="studio-avatar-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      setImage(null);
                    }}
                    title="Remove cover"
                  >
                    ✕
                  </button>
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
                onClick={handleGenerateCover}
                disabled={generatingCover || uploading}
              >
                <Sparkles size={12} style={{ marginRight: 6 }} />
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
