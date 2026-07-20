import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeleteButton from './DeleteButton';

describe('DeleteButton', () => {
  it('renders icon-only by default and calls onConfirm after confirming', async () => {
    const onConfirm = vi.fn();
    render(<DeleteButton confirmTitle="Delete this thing?" onConfirm={onConfirm} />);
    const user = userEvent.setup();

    const button = screen.getByRole('button');
    expect(button).not.toHaveTextContent(/./); // icon only, no label text
    await user.click(button);
    await user.click(await screen.findByText('Delete this thing?'));

    expect(onConfirm).not.toHaveBeenCalled(); // clicking the Popconfirm title itself shouldn't confirm
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('renders a label when given children', () => {
    render(
      <DeleteButton confirmTitle="Delete these?" onConfirm={vi.fn()}>
        Delete
      </DeleteButton>
    );
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument();
  });

  it('does not confirm when disabled', async () => {
    const onConfirm = vi.fn();
    render(<DeleteButton confirmTitle="Delete?" onConfirm={onConfirm} disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
