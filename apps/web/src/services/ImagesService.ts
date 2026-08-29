import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import type { ImageSummary } from '../models/ImageSummary';
import type { ImageUpdateStatus } from '../models/ImageUpdateStatus';
import type { ImageUpdateCheckSummary } from '../models/ImageUpdateCheckSummary';
import { formatBytes } from '../utils';
import { imagesApi } from './api/imagesApi';
import { useBulkAction } from '../hooks/useBulkAction';

type MessageLevel = 'info' | 'success' | 'warning';

/**
 * Framework-agnostic image logic
 */
class ImagesService {
  /**
   * Bulk actions and single-row deletes both key images by their tag, falling back to the image ID for untagged images.
   * @param image <ImageSummary, 'id' | 'tags'>
   * @param fallbackId string
   * @returns Get image tag
   */
  resolveRef(image: Pick<ImageSummary, 'id' | 'tags'> | undefined, fallbackId: string): string {
    return image?.tags[0] ?? fallbackId;
  }

  /**
   * Get images by ids
   * @param images ImageSummary
   * @returns Images by ids
   */
  indexById(images: ImageSummary[]): Map<string, ImageSummary> {
    return new Map(images.map((image) => [image.id, image]));
  }

  /**
   * Get Prune confirmation string
   * @param spaceReclaimed number
   * @returns Prune confirmation message
   */
  pruneMessage(spaceReclaimed: number): string {
    return `Prune complete: ${formatBytes(spaceReclaimed)} reclaimed`;
  }

  /**
   * Get update availability string
   * @param result ImageUpdateStatus
   * @returns Image update message
   */
  checkUpdateMessage(result: ImageUpdateStatus): { level: MessageLevel; text: string } {
    if (result.updateAvailable === true) {
      return { level: 'info', text: `Update available for ${result.reference}` };
    }
    if (result.updateAvailable === false) {
      return { level: 'success', text: `${result.reference} is up to date` };
    }
    return { level: 'warning', text: result.error ?? 'Could not determine update status' };
  }

  /**
   * Get update all string
   * @param result ImageUpdateCheckSummary
   * @returns Update all message
   */
  checkAllUpdatesMessage(result: ImageUpdateCheckSummary): { text: string; errorText?: string } {
    return {
      text: `Checked ${result.checked} image(s) : ${result.updatesAvailable} update(s) available`,
      errorText: result.errors.length ? `${result.errors.length} check(s) could not be completed` : undefined,
    };
  }
}

export const imagesService = new ImagesService();

interface UseImagesServiceOptions {
  onBulkRemoved: () => void;
}

/**
 * React Query adapter around ImagesService
 * @param hostId string
 * @returns Adapter object
 */
export function useImagesService(hostId: string, { onBulkRemoved }: UseImagesServiceOptions) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['images', hostId],
    queryFn: () => imagesApi.list(hostId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['images', hostId] });

  const pull = useMutation({
    mutationFn: (reference: string) => imagesApi.pull(hostId, reference),
    onSuccess: () => {
      message.success('Image pulled');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (ref: string) => imagesApi.remove(hostId, ref),
    onSuccess: () => {
      message.success('Image deleted');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const prune = useMutation({
    mutationFn: () => imagesApi.prune(hostId),
    onSuccess: (result) => {
      message.success(imagesService.pruneMessage(result.spaceReclaimed));
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const checkUpdate = useMutation({
    mutationFn: (id: string) => imagesApi.checkUpdate(hostId, id),
    onSuccess: (result) => {
      const { level, text } = imagesService.checkUpdateMessage(result);
      message[level](text);
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const checkAllUpdates = useMutation({
    mutationFn: () => imagesApi.checkUpdates(hostId),
    onSuccess: (result) => {
      const { text, errorText } = imagesService.checkAllUpdatesMessage(result);
      message.success(text);
      if (errorText) message.warning(errorText);
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const byId = imagesService.indexById(data ?? []);
  const bulkRemove = useBulkAction<string>({
    queryKey: ['images', hostId],
    run: (id) => imagesApi.remove(hostId, imagesService.resolveRef(byId.get(id), id)),
    successLabel: (count) => `${count} image(s) deleted`,
    onSettled: onBulkRemoved,
  });

  return {
    images: data,
    isLoading,
    invalidate,
    pull,
    remove,
    prune,
    checkUpdate,
    checkAllUpdates,
    bulkRemove,
  };
}
