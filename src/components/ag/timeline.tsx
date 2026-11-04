import { useMemo, useState } from 'react';
import type { AgChartOptions } from 'ag-charts-community';
import { AgCharts } from 'ag-charts-react';
import { Tooltip } from '../daw/Tooltip';
import { formatUsd } from '../../hooks/use-earnings';
import { BlockDropdown } from './dropdown';
import {
  BRAND_PALETTE,
  CHART_VIEW_OPTIONS,
  formatMs,
  renderTooltipHtml,
  type ChartView,
  type NormalizedSongRow,
  type OverviewStats,
  type TimeSeriesBucket,
} from './utils';

export interface TimelineChartProps {
  timeSeriesData: TimeSeriesBucket[];
  topPlaysSongs: NormalizedSongRow[];
  topStreamedSongs: NormalizedSongRow[];
  totalSongsCount: number;
  overviewStats: OverviewStats;
  isMobile: boolean;
  focused: boolean;
  onToggleFocus: () => void;
}

export function TimelineChart({
  timeSeriesData,
  topPlaysSongs,
  topStreamedSongs,
  totalSongsCount,
  overviewStats,
  isMobile,
  focused,
  onToggleFocus,
}: TimelineChartProps) {
  const [chartView, setChartView] = useState<ChartView>('profit');

  const chartBadgeLabel = useMemo(() => {
    if (chartView === 'profit') return formatUsd(overviewStats.totalProfitUsd);
    if (chartView === 'plays') return `${overviewStats.totalPlays.toLocaleString()} PLAYS`;
    if (chartView === 'streamed') return formatMs(overviewStats.totalStreamedMs);
    return `AVG ${overviewStats.avgRatioPct.toFixed(1)}%`;
  }, [chartView, overviewStats]);

  const agChartOptions = useMemo<AgChartOptions>(() => {
    const axisFontSize = isMobile ? 11 : 11;
    const terminalFont = "'Share Tech Mono', 'JetBrains Mono', monospace";
    const chartTheme = {
      baseTheme: 'ag-default-dark' as const,
      params: {
        fontFamily: terminalFont,
        fontSize: axisFontSize,
      },
    };
    const baseAxes = {
      x: {
        type: 'category' as const,
        line: { enabled: false },
        tick: { enabled: false },
        gridLine: { enabled: false },
        label: {
          color: '#7a869a',
          fontFamily: terminalFont,
          fontSize: axisFontSize,
          rotation: 0,
          avoidCollisions: true,
        },
      },
      y: {
        type: 'number' as const,
        line: { enabled: false },
        tick: { enabled: false },
        gridLine: {
          enabled: true,
          style: [{ stroke: 'rgba(0, 255, 65, 0.08)', lineDash: [3, 3] }],
        },
        label: {
          color: '#7a869a',
          fontFamily: terminalFont,
          fontSize: axisFontSize,
          formatter: ({ value }: { value: number }) => {
            if (chartView === 'profit') return formatUsd(value);
            if (chartView === 'streamed') return formatMs(value);
            if (chartView === 'ratio') return `${Math.round(value)}%`;
            return Math.round(value).toLocaleString();
          },
        },
      },
    };

    if (chartView === 'profit') {
      return {
        theme: chartTheme,
        background: { fill: 'transparent' },
        padding: { top: 8, right: 18, bottom: 4, left: 6 },
        data: timeSeriesData,
        legend: { enabled: false },
        axes: baseAxes,
        series: [
          {
            type: 'area',
            xKey: 'label',
            yKey: 'royaltiesUsd',
            yName: 'Royalties',
            stroke: '#00ff41',
            strokeWidth: 2,
            fill: '#00ff41',
            fillOpacity: 0.11,
            interpolation: { type: 'smooth' },
            marker: {
              enabled: false,
              fill: '#00ff41',
              stroke: '#050608',
              strokeWidth: 2,
              size: 6,
            },
            tooltip: {
              renderer: ({ datum }) =>
                renderTooltipHtml(datum.label, [
                  {
                    label: 'Royalties',
                    value: formatUsd(datum.royaltiesUsd),
                    color: '#00ff41',
                  },
                  {
                    label: 'Platform fee',
                    value: formatUsd(datum.platformFeeUsd),
                    color: '#00ccff',
                  },
                  {
                    label: 'Total',
                    value: formatUsd(datum.totalUsd),
                    strong: true,
                  },
                  {
                    label: 'Plays',
                    value: datum.plays.toLocaleString(),
                  },
                ]),
            },
          },
        ],
      };
    }

    if (chartView === 'plays') {
      const s0 = topPlaysSongs[0]?.title || 'Top #1';
      const s1 = topPlaysSongs[1]?.title || 'Top #2';
      const s2 = topPlaysSongs[2]?.title || 'Top #3';

      const makeTooltip = ({ datum }: { datum: TimeSeriesBucket }) => {
        const rows: Array<{ label: string; value: string; color?: string; strong?: boolean }> = [];
        if (topPlaysSongs[0]) {
          rows.push({
            label: s0,
            value: datum.playTop0.toLocaleString(),
            color: BRAND_PALETTE[0],
          });
        }
        if (topPlaysSongs[1]) {
          rows.push({
            label: s1,
            value: datum.playTop1.toLocaleString(),
            color: BRAND_PALETTE[1],
          });
        }
        if (topPlaysSongs[2]) {
          rows.push({
            label: s2,
            value: datum.playTop2.toLocaleString(),
            color: BRAND_PALETTE[2],
          });
        }
        if (datum.playOthers > 0 || totalSongsCount > 3) {
          rows.push({
            label: 'Others',
            value: datum.playOthers.toLocaleString(),
            color: BRAND_PALETTE[3],
          });
        }
        rows.push({
          label: 'Total Plays',
          value: datum.plays.toLocaleString(),
          strong: true,
        });
        return renderTooltipHtml(datum.label, rows);
      };

      return {
        theme: chartTheme,
        background: { fill: 'transparent' },
        padding: { top: 8, right: 18, bottom: 4, left: 6 },
        data: timeSeriesData,
        legend: { enabled: false },
        axes: baseAxes,
        series: [
          {
            type: 'bar',
            xKey: 'label',
            yKey: 'playTop0',
            yName: s0,
            stacked: true,
            fill: BRAND_PALETTE[0],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'label',
            yKey: 'playTop1',
            yName: s1,
            stacked: true,
            fill: BRAND_PALETTE[1],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'label',
            yKey: 'playTop2',
            yName: s2,
            stacked: true,
            fill: BRAND_PALETTE[2],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'label',
            yKey: 'playOthers',
            yName: 'Others',
            stacked: true,
            fill: BRAND_PALETTE[3],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
        ],
      };
    }

    if (chartView === 'streamed') {
      const s0 = topStreamedSongs[0]?.title || 'Top #1';
      const s1 = topStreamedSongs[1]?.title || 'Top #2';
      const s2 = topStreamedSongs[2]?.title || 'Top #3';

      const makeTooltip = ({ datum }: { datum: TimeSeriesBucket }) => {
        const rows: Array<{ label: string; value: string; color?: string; strong?: boolean }> = [];
        if (topStreamedSongs[0]) {
          rows.push({
            label: s0,
            value: formatMs(datum.streamTop0),
            color: BRAND_PALETTE[0],
          });
        }
        if (topStreamedSongs[1]) {
          rows.push({
            label: s1,
            value: formatMs(datum.streamTop1),
            color: BRAND_PALETTE[1],
          });
        }
        if (topStreamedSongs[2]) {
          rows.push({
            label: s2,
            value: formatMs(datum.streamTop2),
            color: BRAND_PALETTE[2],
          });
        }
        if (datum.streamOthers > 0 || totalSongsCount > 3) {
          rows.push({
            label: 'Others',
            value: formatMs(datum.streamOthers),
            color: BRAND_PALETTE[3],
          });
        }
        rows.push({
          label: 'Total Streamed',
          value: formatMs(datum.streamedMs),
          strong: true,
        });
        return renderTooltipHtml(datum.label, rows);
      };

      return {
        theme: chartTheme,
        background: { fill: 'transparent' },
        padding: { top: 8, right: 18, bottom: 4, left: 6 },
        data: timeSeriesData,
        legend: { enabled: false },
        axes: baseAxes,
        series: [
          {
            type: 'bar',
            xKey: 'label',
            yKey: 'streamTop0',
            yName: s0,
            stacked: true,
            fill: BRAND_PALETTE[0],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'label',
            yKey: 'streamTop1',
            yName: s1,
            stacked: true,
            fill: BRAND_PALETTE[1],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'label',
            yKey: 'streamTop2',
            yName: s2,
            stacked: true,
            fill: BRAND_PALETTE[2],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'label',
            yKey: 'streamOthers',
            yName: 'Others',
            stacked: true,
            fill: BRAND_PALETTE[3],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
        ],
      };
    }

    const makeRatioTooltip = ({ datum }: { datum: TimeSeriesBucket }) =>
      renderTooltipHtml(datum.label, [
        {
          label: 'Ratio',
          value: `${datum.ratioPct.toFixed(1)}%`,
          color: '#00ff41',
          strong: true,
        },
        {
          label: 'Average (AVG.)',
          value: `${datum.avgRatioPct.toFixed(1)}%`,
          color: '#8892a0',
        },
      ]);

    return {
      theme: chartTheme,
      background: { fill: 'transparent' },
      padding: { top: 8, right: 18, bottom: 4, left: 6 },
      data: timeSeriesData,
      legend: { enabled: false },
      axes: baseAxes,
      series: [
        {
          type: 'line',
          xKey: 'label',
          yKey: 'ratioPct',
          yName: 'Ratio (%)',
          stroke: '#00ff41',
          strokeWidth: 2,
          interpolation: { type: 'smooth' },
          marker: {
            enabled: false,
            fill: '#00ff41',
            stroke: '#050608',
            strokeWidth: 2,
            size: 5,
          },
          tooltip: { renderer: makeRatioTooltip },
        },
        {
          type: 'line',
          xKey: 'label',
          yKey: 'avgRatioPct',
          yName: 'Average (AVG.)',
          stroke: '#8892a0',
          strokeWidth: 1.5,
          lineDash: [4, 3],
          marker: { enabled: false },
          tooltip: { renderer: makeRatioTooltip },
        },
      ],
    };
  }, [chartView, timeSeriesData, topPlaysSongs, topStreamedSongs, totalSongsCount, isMobile]);

  return (
    <section
      className="cm-block"
      data-block="chart"
      data-focused={focused ? 'true' : 'false'}
      onClick={onToggleFocus}
    >
      <header className="cm-block__header">
        <BlockDropdown
          value={chartView}
          options={CHART_VIEW_OPTIONS}
          onChange={setChartView}
          ariaLabel="Chart metric"
        />
        <div className="cm-block__header-side">
          <span className="cm-block__badge">{chartBadgeLabel}</span>
        </div>
      </header>

      <div className="cm-block__body">
        <div className="cm-chart-frame">
          <div className="cm-chart-canvas">
            <AgCharts options={agChartOptions} />
          </div>

          {focused && chartView !== 'profit' && (
            <div className="cm-chart-legend">
              {chartView === 'plays' && (
                <>
                  {topPlaysSongs.map((s, i) => (
                    <Tooltip
                      key={s.songId}
                      title={s.title}
                      description={`${s.rawPlays.toLocaleString()} plays · Genres: ${s.genreLabel}`}
                      position="top"
                      style={{ display: 'inline-flex' }}
                    >
                      <span className="cm-chart-legend__item" title={s.title}>
                        <span
                          className="cm-chart-legend__dot"
                          style={{ background: BRAND_PALETTE[i] }}
                        />
                        {s.title}
                      </span>
                    </Tooltip>
                  ))}
                  {totalSongsCount > 3 && (
                    <span className="cm-chart-legend__item">
                      <span
                        className="cm-chart-legend__dot"
                        style={{ background: BRAND_PALETTE[3] }}
                      />
                      Others
                    </span>
                  )}
                </>
              )}

              {chartView === 'streamed' && (
                <>
                  {topStreamedSongs.map((s, i) => (
                    <Tooltip
                      key={s.songId}
                      title={s.title}
                      description={`${formatMs(s.streamedMs)} streamed · Genres: ${s.genreLabel}`}
                      position="top"
                      style={{ display: 'inline-flex' }}
                    >
                      <span className="cm-chart-legend__item" title={s.title}>
                        <span
                          className="cm-chart-legend__dot"
                          style={{ background: BRAND_PALETTE[i] }}
                        />
                        {s.title}
                      </span>
                    </Tooltip>
                  ))}
                  {totalSongsCount > 3 && (
                    <span className="cm-chart-legend__item">
                      <span
                        className="cm-chart-legend__dot"
                        style={{ background: BRAND_PALETTE[3] }}
                      />
                      Others
                    </span>
                  )}
                </>
              )}

              {chartView === 'ratio' && (
                <>
                  <span className="cm-chart-legend__item">
                    <span className="cm-chart-legend__dot" style={{ background: '#00ff41' }} />
                    Ratio (%)
                  </span>
                  <span className="cm-chart-legend__item">
                    <span className="cm-chart-legend__dot" style={{ background: '#8892a0' }} />
                    AVG. ({overviewStats.avgRatioPct.toFixed(1)}%)
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
