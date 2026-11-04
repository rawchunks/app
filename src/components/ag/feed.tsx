import { useMemo, useState } from 'react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { CheckCircle2, Disc3, ExternalLink, Headphones, Layers, Radio } from 'lucide-react';
import { Tooltip } from '../daw/Tooltip';
import { formatUsd, getNetworkLogo } from '../../hooks/use-earnings';
import { BlockDropdown } from './dropdown';
import {
  DEFAULT_AG_COL_DEF,
  FEED_VIEW_OPTIONS,
  formatMs,
  getFeedRowId,
  shortTx,
  timeAgo,
  type EnrichedEventItem,
  type FeedView,
  type PlaysFilter,
  type SettlementsFilter,
} from './utils';

export interface ActivityFeedProps {
  events: EnrichedEventItem[];
  focused: boolean;
  isMobile: boolean;
  onToggleFocus: () => void;
}

export function ActivityFeed({
  events,
  focused,
  isMobile,
  onToggleFocus,
}: ActivityFeedProps) {
  const [feedView, setFeedView] = useState<FeedView>('plays');
  const [playsFilter, setPlaysFilter] = useState<PlaysFilter>('all');
  const [settlementsFilter, setSettlementsFilter] = useState<SettlementsFilter>('all');

  const filteredPlayEvents = useMemo(() => {
    if (playsFilter === 'all') return events;
    return events.filter((e) => e.kind === playsFilter);
  }, [events, playsFilter]);

  const settlementEvents = useMemo(() => {
    const withSettlement = events.filter(
      (e) => Boolean(e.txHash) || e.royaltiesUsd > 0 || e.totalUsd > 0,
    );
    if (settlementsFilter === 'settled') {
      return withSettlement.filter((e) => Boolean(e.txHash) || e.royaltiesUsd > 0);
    }
    return withSettlement;
  }, [events, settlementsFilter]);

  const feedRows = feedView === 'plays' ? filteredPlayEvents : settlementEvents;

  const streamEventsCount = useMemo(
    () => events.filter((e) => e.kind === 'stream').length,
    [events],
  );
  const licenseEventsCount = useMemo(
    () => events.filter((e) => e.kind === 'license').length,
    [events],
  );
  const totalSettledUsd = useMemo(
    () => settlementEvents.reduce((acc, e) => acc + e.royaltiesUsd, 0),
    [settlementEvents],
  );

  const feedColumnDefs = useMemo<ColDef<EnrichedEventItem>[]>(
    () => [
      {
        headerName: 'Activity',
        field: 'id',
        flex: 1,
        cellRenderer: (params: ICellRendererParams<EnrichedEventItem>) => {
          const ev = params.data;
          if (!ev) return null;
          const logo = getNetworkLogo(ev.network || ev.networkFamily);
          const genreListLabel = ev.genreLabel || ev.genre || 'Audio';
          const genreCount = ev.allGenres?.length ?? 1;

          if (feedView === 'plays') {
            return (
              <div className="cm-receipt-item">
                <div className="cm-receipt-item__top">
                  <Tooltip
                    title={ev.songTitle}
                    description={`Genres: ${genreListLabel} · ${ev.networkLabel}`}
                    position="top"
                    style={{ display: 'inline-flex', minWidth: 0, maxWidth: '100%' }}
                  >
                    <span className="cm-receipt-item__song" title={ev.songTitle}>
                      <span
                        className="cm-feed-summary__dot"
                        data-tone={ev.kind === 'license' ? 'violet' : 'emerald'}
                      />
                      {ev.songTitle}
                    </span>
                  </Tooltip>
                  <span
                    className="cm-receipt-item__amount"
                    data-tone={ev.kind === 'license' ? 'primary' : 'neutral'}
                  >
                    {ev.kind === 'license'
                      ? formatUsd(ev.royaltiesUsd)
                      : formatMs(ev.streamedMs)}
                  </span>
                </div>
                <div className="cm-receipt-item__bottom">
                  <span className="cm-receipt-item__meta">
                    <Tooltip
                      title={genreCount > 1 ? `Genres (${genreCount})` : 'Genre'}
                      description={genreListLabel}
                      position="top"
                      style={{ display: 'inline-flex', minWidth: 0, maxWidth: '100%' }}
                    >
                      <span className="cm-usage-modality" title={genreListLabel}>
                        {genreListLabel}
                      </span>
                    </Tooltip>
                    <span>{ev.ratioPct.toFixed(1)}%</span>
                    {logo && <img src={logo} alt="" className="cm-network-filter__logo" />}
                    <span>{ev.networkLabel.split(' ')[0]}</span>
                  </span>
                  <span className="cm-receipt-item__meta">{timeAgo(ev.timestamp)}</span>
                </div>
                <div className="cm-receipt-detail">
                  <div className="cm-receipt-detail__row">
                    <span>Streamed / Duration</span>
                    <strong>
                      {formatMs(ev.streamedMs)} / {formatMs(ev.durationMs)} (
                      {ev.ratioPct.toFixed(1)}%)
                    </strong>
                  </div>
                  <div className="cm-receipt-detail__row">
                    <span>Royalties</span>
                    <strong>{formatUsd(ev.royaltiesUsd)}</strong>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div className="cm-receipt-item">
              <div className="cm-receipt-item__top">
                <Tooltip
                  title={ev.songTitle}
                  description={`${ev.kind === 'license' ? 'License' : 'Stream'} settlement · Genres: ${genreListLabel} · ${ev.networkLabel}`}
                  position="top"
                  style={{ display: 'inline-flex', minWidth: 0, maxWidth: '100%' }}
                >
                  <span className="cm-receipt-item__song" title={ev.songTitle}>
                    <span className="cm-settlement-badge" data-tone="emerald">
                      <CheckCircle2 size={10} />
                      Settled
                    </span>
                    <span>
                      {ev.kind === 'license' ? 'License' : 'Stream'} · {ev.songTitle}
                    </span>
                  </span>
                </Tooltip>
                <span className="cm-receipt-item__amount" data-tone="primary">
                  {formatUsd(ev.royaltiesUsd)}
                </span>
              </div>
              <div className="cm-receipt-item__bottom">
                <span className="cm-receipt-item__meta">
                  {logo && <img src={logo} alt="" className="cm-network-filter__logo" />}
                  <span>{ev.networkLabel}</span>
                  {ev.txHash && ev.explorerUrl ? (
                    <a
                      href={ev.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="cm-receipt-tx"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span>{shortTx(ev.txHash)}</span>
                      <ExternalLink size={10} />
                    </a>
                  ) : ev.txHash ? (
                    <span>{shortTx(ev.txHash)}</span>
                  ) : null}
                </span>
                <span className="cm-receipt-item__meta">{timeAgo(ev.timestamp)}</span>
              </div>
              <div className="cm-receipt-detail">
                <div className="cm-receipt-detail__row">
                  <span>Royalties (80%)</span>
                  <strong>{formatUsd(ev.royaltiesUsd)}</strong>
                </div>
                <div className="cm-receipt-detail__row">
                  <span>Platform fee (20%)</span>
                  <strong>{formatUsd(ev.platformFeeUsd)}</strong>
                </div>
                <div className="cm-receipt-detail__row">
                  <span>Streamed</span>
                  <strong>{formatMs(ev.streamedMs)}</strong>
                </div>
              </div>
            </div>
          );
        },
      },
    ],
    [feedView],
  );

  return (
    <section
      className="cm-block"
      data-block="feed"
      data-focused={focused ? 'true' : 'false'}
      onClick={onToggleFocus}
    >
      <header className="cm-block__header">
        <BlockDropdown
          value={feedView}
          options={
            isMobile
              ? [
                  {
                    value: 'plays',
                    label: `PLAYS (${streamEventsCount})`,
                    icon: Radio,
                    tooltip: 'Chronological stream and license activity feed',
                  },
                  {
                    value: 'settlements',
                    label: `SETTLEMENTS (${settlementEvents.length})`,
                    icon: Layers,
                    tooltip: 'Verified on-chain royalty settlements and transactions',
                  },
                ]
              : FEED_VIEW_OPTIONS
          }
          onChange={setFeedView}
          ariaLabel="Activity feed view"
        />

        <div className="cm-block__header-side" onClick={(e) => e.stopPropagation()}>
          {feedView === 'plays' ? (
            <BlockDropdown
              value={playsFilter}
              options={[
                {
                  value: 'all',
                  label: 'ALL',
                  count: events.length,
                  icon: Layers,
                  tooltip: 'All stream and license events',
                },
                {
                  value: 'stream',
                  label: 'STREAMED',
                  count: streamEventsCount,
                  icon: Headphones,
                  tooltip: 'Filter to qualified stream plays only',
                },
                {
                  value: 'license',
                  label: 'LICENSED',
                  count: licenseEventsCount,
                  icon: Disc3,
                  tooltip: 'Filter to license purchases only',
                },
              ]}
              onChange={setPlaysFilter}
              ariaLabel="Filter plays"
              align="end"
            />
          ) : (
            <BlockDropdown
              value={settlementsFilter}
              options={[
                {
                  value: 'all',
                  label: 'ALL',
                  count: settlementEvents.length,
                  icon: Layers,
                  tooltip: 'All royalty settlements',
                },
                {
                  value: 'settled',
                  label: 'SETTLED',
                  count: settlementEvents.length,
                  icon: CheckCircle2,
                  tooltip: 'Filter to settled on-chain royalty payouts',
                },
              ]}
              onChange={setSettlementsFilter}
              ariaLabel="Filter settlements"
              align="end"
            />
          )}
        </div>
      </header>

      <div className="cm-block__body">
        <div className="cm-feed-summary">
          {feedView === 'plays' ? (
            <>
              <span className="cm-feed-summary__item">
                <span className="cm-feed-summary__dot" data-tone="emerald" />
                {streamEventsCount} STREAMED
              </span>
              {licenseEventsCount > 0 && (
                <span className="cm-feed-summary__item">
                  <span className="cm-feed-summary__dot" data-tone="violet" />
                  {licenseEventsCount} LICENSED
                </span>
              )}
            </>
          ) : (
            <>
              <span className="cm-feed-summary__item">
                <span className="cm-feed-summary__dot" data-tone="emerald" />
                {settlementEvents.length} SETTLED
              </span>
              <span
                className="cm-feed-summary__item"
                style={{ marginLeft: 'auto', color: 'var(--primary)' }}
              >
                {formatUsd(totalSettledUsd)}
              </span>
            </>
          )}
        </div>

        {feedRows.length === 0 ? (
          <div className="cm-block__empty">
            {feedView === 'plays' ? 'NO PLAYS IN WINDOW' : 'NO SETTLEMENTS IN WINDOW'}
          </div>
        ) : (
          <div
            className="cm-ag-grid-wrap cm-ag-feed"
            onClick={(e) => {
              if (focused) e.stopPropagation();
            }}
          >
            <AgGridReact
              rowData={feedRows}
              columnDefs={feedColumnDefs}
              getRowId={getFeedRowId}
              suppressScrollOnNewData
              defaultColDef={DEFAULT_AG_COL_DEF}
              headerHeight={0}
              rowHeight={focused ? (isMobile ? 104 : 108) : isMobile ? 58 : 60}
              suppressCellFocus
              animateRows
            />
          </div>
        )}
      </div>
    </section>
  );
}
