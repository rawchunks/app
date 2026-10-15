import React from 'react';
import { Modal } from './modal';
import { Button } from './button';
import { Song, Album } from '@/lib/schema';

export interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: Song | null;
  activeAddress?: string | null;
  formattedAddress?: string;
  albums?: Album[];
  onConfirm: (song: Song) => Promise<void>;
  pending?: boolean;
}

export const PublishModal: React.FC<PublishModalProps> = ({
  isOpen,
  onClose,
  song,
  activeAddress,
  formattedAddress,
  albums = [],
  onConfirm,
  pending = false,
}) => {
  if (!song) return null;

  const album = albums.find((a) => a.id === song.album_id);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="CONFIRM PUBLICATION" size="sm">
      <div className="publish-content">
        <div className="publish-desc">
          Publishing will mint this track on-chain and list it on the public Market for streaming and licensing.
        </div>

        <div className="publish-specs">
          <div className="publish-spec-row">
            <span className="publish-label">ACCOUNT</span>
            <span className="publish-val" title={activeAddress || ''}>
              {formattedAddress || activeAddress || '—'}
            </span>
          </div>

          <div className="publish-spec-row">
            <span className="publish-label">TRACK TITLE</span>
            <span className="publish-val">{song.title}</span>
          </div>

          <div className="publish-spec-row">
            <span className="publish-label">ALBUM</span>
            <span className="publish-val">
              {album?.title || song.album_title || 'None (Single)'}
            </span>
          </div>

          <div className="publish-spec-row">
            <span className="publish-label">STREAM RATE</span>
            <span className="publish-val highlight-green">
              ${song.stream_price.toFixed(2)} / MIN
            </span>
          </div>

          <div className="publish-spec-row">
            <span className="publish-label">TOTAL LICENSES</span>
            <span className="publish-val highlight-cyan">
              {song.licenses}
            </span>
          </div>

          <div className="publish-spec-row">
            <span className="publish-label">LICENSE PRICE</span>
            <span className="publish-val highlight-cyan">
              ${song.license_price.toFixed(2)} USDC
            </span>
          </div>
        </div>

        <div className="publish-actions">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            CANCEL
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              await onConfirm(song);
              onClose();
            }}
            disabled={pending}
          >
            {pending ? 'MINTING ON-CHAIN…' : 'CONFIRM & PUBLISH'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
