import React, { useState, useRef, useEffect } from 'react';
import { Modal } from './modal';
import { Button } from './button';
import { sdk } from '@/lib/sdk';
import { useProfile } from '@/hooks/use-profile';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';

export interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  address?: string | null;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  address,
}) => {
  const { nickname: currentNickname, avatar: currentAvatar, updateProfile } = useProfile(address);
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNickname(currentNickname || '');
      setAvatar(currentAvatar || null);
    }
  }, [isOpen, currentNickname, currentAvatar]);

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
        throw new Error(result.error || 'Failed to upload avatar');
      }
      setAvatar(result.imageUrl);
      toast.success('Avatar uploaded');
    } catch (err: any) {
      toast.error(err.message || 'Avatar upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!address) {
      toast.error('Connect wallet first');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        nickname: nickname.trim() || null,
        avatar: avatar || null,
      });
      onClose();
    } catch (err) {
      // Handled by updateProfile toast
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="EDIT PROFILE" size="sm">
      <div className="profile-modal-body">
        <div className="cyber-input-wrap">
          <label className="cyber-input-label">NICKNAME</label>
          <input
            type="text"
            className="cyber-input-field"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="ENTER NICKNAME..."
            maxLength={32}
            autoFocus
          />
        </div>

        <div className="cyber-input-wrap">
          <label className="cyber-input-label">AVATAR IMAGE</label>
          <div className="profile-modal-avatar-row">
            <div className={`studio-avatar-box ${avatar ? 'has-image' : ''}`}>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                className="hidden-file-input"
                onChange={handleFileUpload}
              />
              {avatar ? (
                <>
                  <img
                    src={avatar}
                    alt="Avatar preview"
                    className="studio-avatar-preview"
                    onClick={() => fileInputRef.current?.click()}
                  />
                  <button
                    type="button"
                    className="studio-avatar-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAvatar(null);
                    }}
                    title="Remove avatar"
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

            <div className="profile-modal-avatar-hint">
              Upload your custom artist picture or avatar. Supported formats: PNG, JPG, WebP.
            </div>
          </div>
        </div>

        <div className="profile-modal-actions">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving || uploading}>
            CANCEL
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || uploading}>
            {saving ? 'SAVING...' : 'SAVE PROFILE'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
