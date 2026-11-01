import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from './modal';
import { Button } from './button';
import { Tooltip } from './daw/Tooltip';
import {
  buildShareCopy,
  buildShareDisplayUrl,
  buildShareIntentUrl,
  buildShareUrl,
  copyShareCardToClipboard,
  renderShareCardPng,
  type MintShareData,
} from '../lib/share';

export interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: MintShareData | null;
}

function shortenHash(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, data }) => {
  const [postText, setPostText] = useState('');
  const [copiedField, setCopiedField] = useState<'url' | 'post' | 'tx' | 'cid' | 'card' | null>(null);
  const [coverModalOpen, setCoverModalOpen] = useState(false);
  const cardBlobRef = useRef<Blob | null>(null);
  const cardPromiseRef = useRef<Promise<Blob> | null>(null);

  useEffect(() => {
    if (!data || !isOpen) {
      setCoverModalOpen(false);
      return;
    }
    setPostText(buildShareCopy(data));
    setCopiedField(null);

    let cancelled = false;
    cardBlobRef.current = null;

    const promise = renderShareCardPng(data.title, data.image);
    cardPromiseRef.current = promise;

    promise
      .then((blob) => {
        if (!cancelled) {
          cardBlobRef.current = blob;
        }
      })
      .catch((err) => {
        console.warn('Could not render share card:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [data, isOpen]);

  if (!data) return null;

  const shareUrl = buildShareUrl(data.creator);
  const displayUrl = buildShareDisplayUrl(data.creator);
  const coverSrc = data.image?.trim() || '/branding/mark.svg';

  const markCopied = (field: 'url' | 'post' | 'tx' | 'cid' | 'card') => {
    setCopiedField(field);
    window.setTimeout(() => {
      setCopiedField((prev) => (prev === field ? null : prev));
    }, 2000);
  };

  const copyValue = async (
    value: string,
    field: 'url' | 'post' | 'tx' | 'cid',
    label: string
  ) => {
    try {
      await navigator.clipboard.writeText(value);
      markCopied(field);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`);
    }
  };

  const getCardSource = (): Blob | Promise<Blob> => {
    if (cardBlobRef.current) return cardBlobRef.current;
    if (cardPromiseRef.current) return cardPromiseRef.current;
    const promise = renderShareCardPng(data.title, data.image);
    cardPromiseRef.current = promise;
    promise
      .then((blob) => {
        cardBlobRef.current = blob;
      })
      .catch(() => {});
    return promise;
  };

  const handleCopyCard = async () => {
    const copied = await copyShareCardToClipboard(getCardSource());
    if (copied) {
      markCopied('card');
      toast.success('Cover frame copied — paste (⌘V / Ctrl+V) in X');
    } else {
      toast.error('Could not copy cover frame');
    }
  };

  const handleCopyPost = () => {
    void copyValue(postText.trim(), 'post', 'Post');
  };

  const handlePostOnX = async () => {
    const intentUrl = buildShareIntentUrl(postText);
    const copied = await copyShareCardToClipboard(getCardSource());
    if (copied) {
      markCopied('card');
      toast.success('Cover frame copied — paste (⌘V / Ctrl+V) in X');
    }
    window.open(intentUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={data.justPublished ? 'TRACK PUBLISHED' : 'SHARE TRACK'}
        size="sm"
      >
        <div className="publish-content">
          <div className="publish-specs">
            <div className="publish-spec-row">
              <span className="publish-label">TRACK</span>
              <Tooltip title={data.title} className="publish-val-wrap">
                <span className="publish-val highlight-green">{data.title}</span>
              </Tooltip>
            </div>

            <div className="publish-spec-row">
              <span className="publish-label">CATALOG LINK</span>
              <Tooltip title="Copy Creator Market Link" description={shareUrl}>
                <button
                  type="button"
                  className="mypage-copy-btn share-spec-copy-btn"
                  onClick={() => void copyValue(shareUrl, 'url', 'Catalog link')}
                  aria-label="Copy catalog link"
                >
                  <span className="share-spec-copy-text">{displayUrl}</span>
                  {copiedField === 'url' ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </Tooltip>
            </div>

            {data.txHash && (
              <div className="publish-spec-row">
                <span className="publish-label">MINT TX</span>
                <Tooltip title="Copy Mint Transaction" description={data.txHash}>
                  <button
                    type="button"
                    className="mypage-copy-btn share-spec-copy-btn"
                    onClick={() => void copyValue(data.txHash!, 'tx', 'Transaction hash')}
                    aria-label="Copy transaction hash"
                  >
                    <span className="share-spec-copy-text">{shortenHash(data.txHash)}</span>
                    {copiedField === 'tx' ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                </Tooltip>
              </div>
            )}

            {data.metadataCid && (
              <div className="publish-spec-row">
                <span className="publish-label">METADATA CID</span>
                <Tooltip title="Copy Metadata CID" description={data.metadataCid}>
                  <button
                    type="button"
                    className="mypage-copy-btn share-spec-copy-btn"
                    onClick={() => void copyValue(data.metadataCid!, 'cid', 'Metadata CID')}
                    aria-label="Copy metadata CID"
                  >
                    <span className="share-spec-copy-text">{shortenHash(data.metadataCid)}</span>
                    {copiedField === 'cid' ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                </Tooltip>
              </div>
            )}
          </div>

          <div className="cyber-input-wrap share-compose-wrap">
            <div className="share-compose-header">
              <span className="cyber-input-label">X POST</span>
              <span className="share-compose-char-count">{postText.length}/280</span>
            </div>

            <div className="share-compose-body">
              <div className="share-native-frame">
                <Tooltip
                  title="Expand Cover Art"
                  description="Click to view full-size cover art"
                  className="share-card-preview-tooltip"
                >
                  <button
                    type="button"
                    className="share-native-frame-art"
                    onClick={() => setCoverModalOpen(true)}
                    aria-label="Expand cover art"
                  >
                    <img
                      src={coverSrc}
                      alt={data.title}
                      className="share-native-frame-img"
                    />
                  </button>
                </Tooltip>
                <Tooltip
                  title="Copy Cover Frame"
                  description="Copy image to paste (⌘V / Ctrl+V) in X"
                  className="share-native-frame-copy-wrap"
                >
                  <button
                    type="button"
                    className={`share-native-frame-copy-btn${copiedField === 'card' ? ' copied' : ''}`}
                    onClick={() => void handleCopyCard()}
                    aria-label="Copy cover frame"
                  >
                    {copiedField === 'card' ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                </Tooltip>
              </div>

              <textarea
                className="cyber-input-field share-compose-textarea"
                rows={5}
                maxLength={280}
                value={postText}
                onChange={(e) => setPostText(e.target.value)}
                aria-label="X post text"
              />
            </div>
          </div>

          <div className="publish-actions">
            <Button variant="secondary" size="sm" onClick={handleCopyPost}>
              {copiedField === 'post' ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedField === 'post' ? 'COPIED' : 'COPY POST'}</span>
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handlePostOnX()}>
              <ExternalLink size={12} />
              <span>POST ON X</span>
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={coverModalOpen}
        onClose={() => setCoverModalOpen(false)}
        title={data.title.trim() || 'COVER ART'}
        size="sm"
      >
        <img
          src={coverSrc}
          alt={data.title || 'Cover art'}
          className="studio-cover-expanded-img"
        />
      </Modal>
    </>
  );
};
export default ShareModal;
