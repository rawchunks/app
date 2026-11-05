import { useGuideOwner, prepareViews } from '../guide/owners';
import { useRef, useState } from 'react';
import { Tag, GitFork, CreditCard, ShieldCheck } from 'lucide-react';
import { Button } from '../button';
import { Badge } from '../badge';
import { Tooltip } from '../daw/Tooltip';
import { weiToUsdc } from '../../lib/chains';
import { Modal } from '../modal';
import { PayPalCardFields } from '../connector';
import { useLicense } from '../../hooks/use-license';
import type { Song } from '../../lib/schema';

export function Licenses({
  song,
  onEditSong,
  placement,
  compact = false,
}: {
  song: Song;
  onEditSong?: (song: Song) => void;
  placement: 'market' | 'mypage';
  compact?: boolean;
}) {
  const {
    data,
    buy,
    createFiatOrder,
    completeFiatOrder,
    buyWithStripeBridge,
    testnetMode,
    remix,
    pending,
    error,
    sold,
    salesError,
  } = useLicense(song, onEditSong, placement === 'mypage', placement === 'mypage');
  const [confirm, setConfirm] = useState(false);
  const [cardMode, setCardMode] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const operationRef = useRef<{ operationId: string; orderId: string; price?: bigint } | null>(null);
  const requestKeyRef = useRef<string>('');

  const openModal = () => {
    setCardMode(false);
    setCardError(null);
    operationRef.current = null;
    requestKeyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
    setConfirm(true);
  };

  const closeModal = () => {
    setConfirm(false);
    setCardMode(false);
    setCardError(null);
  };

  const guideView = { confirm, cardMode };
  const guideViewRef = useRef(guideView); guideViewRef.current = guideView;
  useGuideOwner({
    id: 'license', scope: `${placement}:${song.id}`, handles: step => step.id === 'M5', prepare: ({ bind }) => {
      if (placement !== 'market') return;
      const id = bind('song', song.id);
      if (id !== song.id) return;
      if (song.source || song.is_remix || data?.owned || pending || song.licenses <= 0 || !song.chain_song_id) return { target: 'card.license-status', entity: song.id, description: 'A license purchase is not available for this track.' };
      if (cardMode) return { unavailable: 'Finish or cancel the current card checkout before continuing.' };
      return { ...prepareViews(guideView, () => guideViewRef.current, { confirm: setConfirm, cardMode: setCardMode }, { confirm: true }), target: 'license.review', entity: song.id, focus: '.session-balance-strip' };
    }
  });

  if (placement === 'market' && (song.source || song.is_remix)) {
    return (
      <Tooltip title="Remix Track" description="This song is derived from another work">
        <Badge variant="secondary">
          <GitFork size={10} />
          <span className="remix-btn-label">REMIX</span>
        </Badge>
      </Tooltip>
    );
  }

  const priceDisplay = data ? weiToUsdc(data.price.toString()).toFixed(2) : song.license_price.toFixed(2);

  return (
    <>
      {placement === 'mypage' && !compact && (
        <Tooltip title="Licenses Sold" description={(salesError ?? error)?.message}>
          <Badge variant={sold ? 'secondary' : 'muted'}>
            {sold !== undefined ? `${sold} SOLD` : !song.chain_song_id ? '0 SOLD' : salesError || error ? 'SALES UNAVAILABLE' : 'LOADING SALES'}
          </Badge>
        </Tooltip>
      )}

      {placement === 'market' && !data?.owned && (
        <Tooltip
          title={pending ? 'Confirming Purchase…' : 'Buy License'}
          description={
            pending
              ? 'Confirming transaction on-chain…'
              : (error?.message || `$${priceDisplay} USDC • Commercial stem & remix rights`)
          }
        >
          <Button
            variant="accent"
            size="sm"
            onClick={openModal}
            disabled={pending || song.licenses <= 0 || !song.chain_song_id}
            data-guide="card.license-status" aria-label="Buy License"
            className={compact ? 'market-btn-icon' : ''}
          >
            <Tag size={13} />
            {!compact && <span>{pending ? 'CONFIRMING…' : 'BUY LICENSE'}</span>}
          </Button>
        </Tooltip>
      )}

      {(data?.owned || (placement === 'mypage' && compact)) && (
        <Tooltip title="Remix in Studio" description="Open stems in Studio to create a remix">
          <Button
            variant="accent"
            size="sm"
            onClick={() => {
              if (data?.owned) {
                void remix();
              } else if (onEditSong) {
                onEditSong(song);
              }
            }}
            disabled={pending}
            aria-label="Remix Song"
            className={compact ? 'market-btn-icon' : ''}
          >
            <GitFork size={13} />
            {!compact && <span className="remix-btn-label">{pending ? 'OPENING…' : 'REMIX'}</span>}
          </Button>
        </Tooltip>
      )}

      <Modal guideOwner="license" guideAnchor="license.review" guideEntity={song.id} isOpen={confirm} onClose={closeModal} title="BUY COMMERCIAL LICENSE" size="md">
        <div className="session-modal-content">
          <div className="session-info-strip">
            <Tag className="session-info-icon" size={18} />
            <div className="session-info-text">
              <span className="session-info-title">{song.title.toUpperCase()}</span>
              <span className="session-info-desc">
                Purchasing this commercial license grants stem access and the right to create minted derivatives &amp; remixes.
              </span>
            </div>
          </div>
          <div className="session-balance-strip">
            <span className="session-balance-chain">COMMERCIAL LICENSE PRICE</span>
            <span className="session-balance-val">
              ${priceDisplay} USDC
            </span>
          </div>
          {cardMode && testnetMode ? (
            <PayPalCardFields
              createOrder={async () => {
                setCardError(null);
                try {
                  const created = await createFiatOrder(requestKeyRef.current);
                  operationRef.current = { operationId: created.operationId, orderId: created.orderId, price: created.price };
                  return created.orderId;
                } catch (err) {
                  operationRef.current = null;
                  requestKeyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
                  throw err;
                }
              }}
              onApprove={async approved => {
                if (!operationRef.current || approved.orderID !== operationRef.current.orderId) {
                  operationRef.current = null;
                  requestKeyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
                  throw new Error('Checkout order mismatch');
                }
                const currentOp = operationRef.current;
                try {
                  await completeFiatOrder(currentOp);
                  operationRef.current = null;
                  requestKeyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
                  closeModal();
                } catch (err) {
                  operationRef.current = null;
                  requestKeyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
                  throw err;
                }
              }}
              onError={msg => {
                if (msg && operationRef.current) {
                  operationRef.current = null;
                  requestKeyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
                }
                setCardError(msg);
              }}
              onCancel={() => setCardMode(false)}
              cancelLabel="BACK"
              submitLabel={`PAY $${priceDisplay}`}
              submitVariant="accent"
              disabled={pending}
              error={cardError}
              notice="80% to the creator and 20% to Rawchunks."
              showBrand={false}
            />
          ) : (
            <>
              <div className="session-notice-strip">
                <ShieldCheck className="session-notice-icon" size={14} />
                <span>80% to the creator and 20% to Rawchunks.</span>
              </div>
              {error && (
                <div className="session-error-strip" role="alert">
                  <span>{error.message}</span>
                </div>
              )}
              <div className="session-actions-footer">
                <Button variant="ghost" size="sm" onClick={closeModal} disabled={pending}>
                  CANCEL
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (testnetMode) {
                      setCardError(null);
                      operationRef.current = null;
                      requestKeyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
                      setCardMode(true);
                    } else {
                      closeModal();
                      void buyWithStripeBridge();
                    }
                  }}
                >
                  <CreditCard size={13} />
                  <span>PAY WITH CARD</span>
                </Button>
                <Button
                  variant="accent"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    closeModal();
                    void buy();
                  }}
                >
                  CONFIRM PURCHASE
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}


