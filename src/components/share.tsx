import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Mail, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from './modal';
import { Button } from './button';
import { Tooltip } from './daw/Tooltip';
import { SocialPlatformGlyph } from './profile';
import {
  buildShareCopy,
  buildShareDisplayUrl,
  buildShareIntentUrl,
  buildShareUrl,
  copyShareCardToClipboard,
  renderShareCardPng,
  type MintShareData,
} from '../lib/share';

export interface ShareUrlModalProps {
  isOpen: boolean;
  onClose: () => void;
  creator: string;
  title?: string;
}

export const ShareUrlModal: React.FC<ShareUrlModalProps> = ({
  isOpen,
  onClose,
  creator,
  title = 'SHARE',
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) setCopied(false);
  }, [isOpen]);

  const cleanUrl = buildShareUrl(creator);
  const displayUrl = buildShareDisplayUrl(creator);
  const encodedUrl = encodeURIComponent(cleanUrl);

  const socialTargets = [
    {
      id: 'x',
      label: 'X',
      href: `https://x.com/intent/post?url=${encodedUrl}`,
      icon: <SocialPlatformGlyph platform="x" size={16} />,
    },
    {
      id: 'telegram',
      label: 'Telegram',
      href: `https://t.me/share/url?url=${encodedUrl}`,
      icon: <SocialPlatformGlyph platform="telegram" size={16} />,
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      href: `https://wa.me/?text=${encodedUrl}`,
      icon: (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12.031 2c-5.516 0-9.969 4.453-9.969 9.969 0 1.766.469 3.484 1.344 5l-1.406 5.031 5.156-1.344c1.469.813 3.141 1.25 4.875 1.25 5.516 0 9.969-4.453 9.969-9.969S17.547 2 12.031 2zm5.813 14.125c-.25.688-1.438 1.313-2 1.406-.531.094-1.219.125-1.969-.125-.469-.156-1.063-.344-1.813-.688-3.188-1.375-5.281-4.594-5.438-4.813-.156-.219-1.281-1.719-1.281-3.281s.813-2.313 1.094-2.625c.281-.313.625-.375.844-.375.219 0 .406.031.594.031.188 0 .438-.063.688.531.25.594.844 2.063.906 2.219.063.156.094.344 0 .531-.094.188-.156.313-.313.5-.156.188-.313.406-.469.531-.156.156-.313.313-.125.625.188.313.813 1.344 1.75 2.188 1.219 1.094 2.219 1.438 2.531 1.594.313.156.5.125.688-.094.188-.219.813-.938 1.031-1.25.219-.313.438-.25.719-.156.281.094 1.844.875 2.156 1.031.313.156.531.25.594.375.094.125.094.719-.156 1.406z" />
        </svg>
      ),
    },
    {
      id: 'farcaster',
      label: 'Farcaster',
      href: `https://warpcast.com/~/compose?embeds[]=${encodedUrl}`,
      icon: <SocialPlatformGlyph platform="farcaster" size={16} />,
    },
    {
      id: 'reddit',
      label: 'Reddit',
      href: `https://www.reddit.com/submit?url=${encodedUrl}`,
      icon: (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
        </svg>
      ),
    },
    {
      id: 'email',
      label: 'Email',
      href: `mailto:?body=${encodedUrl}`,
      icon: <Mail size={16} />,
    },
  ];

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(cleanUrl);
      setCopied(true);
      toast.success('Link copied');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy link');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="publish-content">
        <div className="cyber-input-wrap">
          <span className="cyber-input-label">SHARE TO</span>
          <div className="share-socials-grid">
            {socialTargets.map((target) => (
              <Tooltip key={target.id} title={target.label}>
                <a
                  href={target.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="share-social-btn"
                  aria-label={target.label}
                >
                  {target.icon}
                </a>
              </Tooltip>
            ))}
            {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
              <Tooltip title="More">
                <button
                  type="button"
                  className="share-social-btn"
                  onClick={() => {
                    void navigator.share({ url: cleanUrl }).catch(() => {});
                  }}
                  aria-label="More"
                >
                  <Share2 size={16} />
                </button>
              </Tooltip>
            )}
          </div>
        </div>

        <div className="cyber-input-wrap">
          <span className="cyber-input-label">COPY LINK</span>
          <div className="share-copy-link-row">
            <span className="share-copy-link-url" title={cleanUrl}>
              {displayUrl}
            </span>
            <Button variant="primary" size="sm" onClick={() => void handleCopyLink()}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span>{copied ? 'COPIED' : 'COPY LINK'}</span>
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

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
  }, [data, data?.creator, data?.title, isOpen]);

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
