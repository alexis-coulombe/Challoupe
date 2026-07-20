import { Button, Tooltip } from 'antd';
import { StarFilled, StarOutlined } from '@ant-design/icons';
import { useFavorites, type FavoriteType } from '../hooks/useFavorites';

export default function FavoriteButton({
  type,
  id,
  label,
  size = 'small',
}: {
  type: FavoriteType;
  id: string;
  label: string;
  size?: 'small' | 'middle';
}) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(type, id);
  return (
    <Tooltip title={active ? 'Remove from favorites' : 'Add to favorites'}>
      <Button
        size={size}
        type="text"
        aria-label="favorite-toggle"
        icon={active ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle(type, id, label);
        }}
      />
    </Tooltip>
  );
}
