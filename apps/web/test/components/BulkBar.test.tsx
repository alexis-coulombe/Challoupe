import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BulkBar from '../../src/components/BulkBar';

describe('BulkBar', () => {
  it('renders nothing when count is zero', () => {
    const { container } = render(
      <BulkBar count={0} onClear={vi.fn()}>
        <button>Action</button>
      </BulkBar>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count and its children when items are selected', () => {
    render(
      <BulkBar count={3} onClear={vi.fn()}>
        <button>Delete</button>
      </BulkBar>
    );
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('calls onClear when the Clear button is clicked', async () => {
    const onClear = vi.fn();
    render(
      <BulkBar count={2} onClear={onClear}>
        <span />
      </BulkBar>
    );
    await userEvent.click(screen.getByRole('button', { name: /Clear/ }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
