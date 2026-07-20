import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Sparkline from './Sparkline';

describe('Sparkline', () => {
  it('renders an area fill and no legend for a single series', () => {
    const { container } = render(
      <Sparkline series={[{ id: 'cpu', label: 'CPU', color: '#3b82f6', points: [10, 20, 30, 15] }]} />
    );
    const paths = container.querySelectorAll('path');
    // One area path (fill) + one line path for the single series.
    expect(paths.length).toBe(2);
    expect(container.textContent).not.toContain('CPU');
  });

  it('renders a legend with end values for two series and no area fill', () => {
    const { getByText, container } = render(
      <Sparkline
        series={[
          { id: 'rx', label: 'RX', color: '#3b82f6', points: [100, 200, 150] },
          { id: 'tx', label: 'TX', color: '#9085e9', points: [50, 60, 70] },
        ]}
        formatValue={(v) => `${v} B/s`}
      />
    );
    // No area fill for multi-series: exactly one path per series (the line).
    expect(container.querySelectorAll('path').length).toBe(2);
    expect(getByText('RX')).toBeInTheDocument();
    expect(getByText('TX')).toBeInTheDocument();
    expect(getByText('150 B/s')).toBeInTheDocument();
    expect(getByText('70 B/s')).toBeInTheDocument();
  });

  it('renders an empty placeholder when there are fewer than two points', () => {
    const { container } = render(
      <Sparkline series={[{ id: 'cpu', label: 'CPU', color: '#3b82f6', points: [10] }]} />
    );
    expect(container.querySelector('svg')).toBeNull();
  });
});
