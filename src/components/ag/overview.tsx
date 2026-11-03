import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  Clock,
  Disc3,
  DollarSign,
  Headphones,
  Layers,
} from 'lucide-react';
import { Tooltip } from '../daw/Tooltip';
import { formatUsd } from '../../hooks/use-earnings';
import { formatMs, ratioTone, type OverviewStats, type StatId } from './utils';

export function Sparkline({ values }: { values: number[] }) {
  const gradId = React.useId();
  if (values.length < 2 || values.every((v) => v === 0)) {
    return <div className="cm-stat-card__spark cm-stat-card__spark--flat" aria-hidden="true" />;
  }
  const w = 120;
  const h = 24;
  const max = Math.max(...values, 0.000001);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 0.000001);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - 2 - ((v - min) / span) * (h - 4);
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;

  return (
    <svg
      className="cm-stat-card__spark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface OverviewCardsProps {
  stats: OverviewStats;
}

export function OverviewCards({ stats }: OverviewCardsProps) {
  const [selectedStat, setSelectedStat] = useState<StatId>('profit');
  const [statPickerOpen, setStatPickerOpen] = useState(false);
  const statPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!statPickerOpen) return;
    function handleOutside(e: MouseEvent) {
      if (statPickerRef.current && !statPickerRef.current.contains(e.target as Node)) {
        setStatPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [statPickerOpen]);

  const statPickerItems: Array<{
    id: StatId;
    label: string;
    value: string;
    icon: React.ComponentType<{ className?: string }>;
    tooltip: string;
  }> = [
    {
      id: 'profit',
      label: 'Profit',
      value: formatUsd(stats.totalProfitUsd),
      icon: DollarSign,
      tooltip: 'Net creator royalties (80% share) from streams and licenses',
    },
    {
      id: 'plays',
      label: 'Plays',
      value: stats.totalPlays.toLocaleString(),
      icon: Headphones,
      tooltip: 'Qualified streams played for 30 seconds or more',
    },
    {
      id: 'streamed',
      label: 'Streamed',
      value: formatMs(stats.totalStreamedMs),
      icon: Clock,
      tooltip: 'Total exact listening duration across all plays',
    },
    {
      id: 'ratio',
      label: 'Avg Ratio',
      value: `${stats.avgRatioPct.toFixed(1)}%`,
      icon: Activity,
      tooltip: 'Average % of track duration streamed per play',
    },
    {
      id: 'licenses',
      label: 'Licenses',
      value: `${stats.licensesSold} / ${stats.licensesMinted}`,
      icon: Disc3,
      tooltip: 'Commercial & remix licenses sold out of total minted supply',
    },
  ];
  const otherStatItems = statPickerItems.filter((s) => s.id !== selectedStat);

  return (
    <section className="cm-overview" data-selected-stat={selectedStat}>
      <div className="cm-overview-grid">
        {/* 1. PROFIT */}
        <div className="cm-stat-card" data-stat="profit">
          <Tooltip
            title="Profit"
            description="Net creator royalties (80% share) from streams and licenses"
            position="bottom"
            style={{ display: 'inline-flex', width: 'fit-content' }}
          >
            <span className="cm-stat-card__label">
              <DollarSign className="cm-stat-card__label-icon" />
              Profit
            </span>
          </Tooltip>
          <span className="cm-stat-card__value" data-tone="primary">
            {formatUsd(stats.totalProfitUsd)}
          </span>
          <span className="cm-stat-card__sub">
            {stats.totalPlays.toLocaleString()} plays settled
          </span>
          <Sparkline values={stats.profitSparkline} />
        </div>

        {/* 2. PLAYS */}
        <div className="cm-stat-card" data-stat="plays">
          <Tooltip
            title="Plays"
            description="Qualified streams played for 30 seconds or more"
            position="bottom"
            style={{ display: 'inline-flex', width: 'fit-content' }}
          >
            <span className="cm-stat-card__label">
              <Headphones className="cm-stat-card__label-icon" />
              Plays
            </span>
          </Tooltip>
          <span className="cm-stat-card__value">{stats.totalPlays.toLocaleString()}</span>
          <span className="cm-stat-card__sub">
            <span className="cm-stat-card__pill" data-tone={ratioTone(stats.avgRatioPct)}>
              {stats.avgRatioPct.toFixed(1)}% ratio
            </span>
          </span>
        </div>

        {/* 3. STREAMED */}
        <div className="cm-stat-card" data-stat="streamed">
          <Tooltip
            title="Streamed"
            description="Total exact listening duration across all plays"
            position="bottom"
            style={{ display: 'inline-flex', width: 'fit-content' }}
          >
            <span className="cm-stat-card__label">
              <Clock className="cm-stat-card__label-icon" />
              Streamed
            </span>
          </Tooltip>
          <span className="cm-stat-card__value">{formatMs(stats.totalStreamedMs)}</span>
          <span className="cm-stat-card__sub">{formatMs(stats.avgMsPerPlay)} / play</span>
        </div>

        {/* 4. RATIO */}
        <div className="cm-stat-card" data-stat="ratio">
          <Tooltip
            title="Avg Ratio"
            description="Average % of song duration streamed per play"
            position="bottom"
            style={{ display: 'inline-flex', width: 'fit-content' }}
          >
            <span className="cm-stat-card__label">
              <Activity className="cm-stat-card__label-icon" />
              Avg Ratio
            </span>
          </Tooltip>
          <span className="cm-stat-card__value">{stats.avgRatioPct.toFixed(1)}%</span>
          <span className="cm-stat-card__sub">peak {stats.peakRatioPct.toFixed(1)}%</span>
        </div>

        {/* 5. LICENSES */}
        <div className="cm-stat-card" data-stat="licenses">
          <Tooltip
            title="Licenses"
            description="Commercial & remix licenses sold vs. total minted supply"
            position="bottom"
            style={{ display: 'inline-flex', width: 'fit-content' }}
          >
            <span className="cm-stat-card__label">
              <Disc3 className="cm-stat-card__label-icon" />
              Licenses
            </span>
          </Tooltip>
          <span className="cm-stat-card__value" data-tone="accent">
            {stats.licensesSold} / {stats.licensesMinted}
          </span>
          <span className="cm-stat-card__sub">
            {formatUsd(stats.licenseProfitUsd)} royalties
          </span>
        </div>

        {/* Narrow Viewport Picker Card (@container max-width: 42rem) */}
        <div ref={statPickerRef} className="cm-dropdown-wrap cm-stat-card--picker-wrap">
          <button
            type="button"
            className="cm-stat-card cm-stat-card--picker"
            style={{ width: '100%', height: '100%' }}
            onClick={() => setStatPickerOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={statPickerOpen}
            aria-label={`More stats: ${otherStatItems.map((s) => s.label).join(', ')}`}
            title="Switch KPI metric"
          >
            <span className="cm-stat-card__label">
              <Layers className="cm-stat-card__label-icon" />
              More stats
            </span>
            <span className="cm-stat-card--picker__value">
              <span className="cm-stat-card__value">{otherStatItems.length}</span>
              <ChevronDown className="cm-stat-card--picker__chevron" />
            </span>
            <span className="cm-stat-card__sub">swap this card</span>
          </button>

          {statPickerOpen && (
            <div className="cm-dropdown-menu" data-align="end" role="listbox">
              {otherStatItems.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selectedStat === item.id}
                    className="cm-dropdown-item"
                    data-active="false"
                    title={item.tooltip}
                    onClick={() => {
                      setSelectedStat(item.id);
                      setStatPickerOpen(false);
                    }}
                  >
                    <ItemIcon className="cm-dropdown-item__icon" />
                    <span>{item.label}</span>
                    <span className="cm-stat-card--picker__item-value">{item.value}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
