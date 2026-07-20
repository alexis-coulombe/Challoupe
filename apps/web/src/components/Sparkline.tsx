import { useRef, useState } from 'react';

export interface SparklineSeries {
  id: string;
  label: string;
  color: string;
  points: number[];
}

interface SparklineProps {
  series: SparklineSeries[];
  height?: number;
  domain?: [number, number];
  formatValue?: (value: number) => string;
}

const WIDTH = 240;

// Minimal inline-SVG trend chart: a single series gets a line + a light area
// wash (the "stat tile trend" case); two or more series get a small legend,
// direct end-labels, and no area fill (the "compare series over time" case).
export default function Sparkline({ series, height = 48, domain, formatValue }: SparklineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const count = Math.max(...series.map((s) => s.points.length), 0);
  if (count < 2) {
    return <div style={{ height }} />;
  }

  const allValues = series.flatMap((s) => s.points);
  const [minY, maxY] = domain ?? [
    Math.min(0, ...allValues),
    Math.max(1, ...allValues) * 1.15,
  ];
  const span = maxY - minY || 1;

  const toX = (i: number) => (i / (count - 1)) * WIDTH;
  const toY = (v: number) => height - ((v - minY) / span) * height;

  const linePath = (points: number[]) =>
    points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`).join(' ');

  const areaPath = (points: number[]) =>
    `${linePath(points)} L ${toX(points.length - 1).toFixed(1)} ${height} L 0 ${height} Z`;

  const format = formatValue ?? ((v: number) => v.toFixed(1));

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverIndex(Math.round(ratio * (count - 1)));
  };

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%' }}
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverIndex(null)}
    >
      <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" height={height} preserveAspectRatio="none">
        {series.length === 1 && (
          <path d={areaPath(series[0].points)} fill={series[0].color} opacity={0.1} stroke="none" />
        )}
        {series.map((s) => (
          <path
            key={s.id}
            d={linePath(s.points)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {series.map((s) => {
          const last = s.points[s.points.length - 1];
          return (
            <circle
              key={s.id}
              cx={toX(s.points.length - 1)}
              cy={toY(last)}
              r={4}
              fill={s.color}
              stroke="#0b0e14"
              strokeWidth={2}
            />
          );
        })}
        {hoverIndex !== null && (
          <line
            x1={toX(hoverIndex)}
            x2={toX(hoverIndex)}
            y1={0}
            y2={height}
            stroke="rgba(255,255,255,0.25)"
            strokeWidth={1}
          />
        )}
      </svg>

      {hoverIndex !== null && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: `${Math.min(85, Math.max(0, (hoverIndex / (count - 1)) * 100))}%`,
            transform: 'translate(4px, 0)',
            background: '#1a2029',
            border: '1px solid #2a3441',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11,
            lineHeight: 1.5,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          {series.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: s.color }} />
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>{s.label}</span>
              <span style={{ color: '#e6e8eb', fontWeight: 600 }}>
                {format(s.points[Math.min(hoverIndex, s.points.length - 1)])}
              </span>
            </div>
          ))}
        </div>
      )}

      {series.length >= 2 && (
        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          {series.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: s.color }} />
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>{s.label}</span>
              <span style={{ color: '#e6e8eb', fontWeight: 600 }}>
                {format(s.points[s.points.length - 1])}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
