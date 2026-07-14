import { toast } from '$lib/ui/toast';
import { prepareFiles } from '$lib/attachments/prepareFiles';
import {
  hasBlockedExecutableMetadata,
  hasUnsafeAttachmentFilename,
  isBlockedExecutableFile,
  MAX_MESSAGE_ATTACHMENTS
} from '$lib/attachments/filePolicy';
import * as m from '$lib/i18n/messages';

export type FileWithUrl = { file: File; url: string };

export type AttachmentLimits = {
  maxUploadSize: number;
  maxVideoUploadSize: number;
};

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} bytes`;
}

export class AttachmentsState {
  filesWithUrls = $state<FileWithUrl[]>([]);
  pendingCount = $state(0);
  private generation = 0;

  constructor(private readonly getLimits: () => AttachmentLimits) {}

  get selectedFiles(): File[] {
    return this.filesWithUrls.map((f) => f.file);
  }

  restore(files: FileWithUrl[]): void {
    this.filesWithUrls = files;
  }

  invalidatePending(): void {
    this.generation += 1;
  }

  validateFiles(files: File[]): File[] {
    const limits = this.getLimits();
    const accepted: File[] = [];
    for (const file of files) {
      if (hasUnsafeAttachmentFilename(file.name)) {
        toast.error(m['room.attachment.invalid_filename']());
        continue;
      }
      if (hasBlockedExecutableMetadata(file)) {
        toast.error(m['room.attachment.executable_not_allowed']({ filename: file.name }));
        continue;
      }

      const isVideo = file.type.startsWith('video/');
      const limit = isVideo ? limits.maxVideoUploadSize : limits.maxUploadSize;
      if (file.size > limit) {
        toast.error(
          m['room.attachment.too_large']({
            filename: file.name,
            size: formatFileSize(file.size),
            max: formatFileSize(limit)
          })
        );
      } else {
        accepted.push(file);
      }
    }
    return accepted;
  }

  filesToPreviewItems(files: File[]): FileWithUrl[] {
    return files.map((file) => ({
      file,
      url: URL.createObjectURL(file)
    }));
  }

  async stageFiles(files: File[]): Promise<void> {
    const candidates = this.validateFiles(files);
    if (candidates.length === 0) return;

    const availableSlots = Math.max(
      0,
      MAX_MESSAGE_ATTACHMENTS - this.filesWithUrls.length - this.pendingCount
    );
    if (availableSlots === 0) {
      toast.error(m['room.attachment.too_many']({ max: MAX_MESSAGE_ATTACHMENTS }));
      return;
    }

    const reservedSlots = Math.min(availableSlots, candidates.length);
    const generation = this.generation;
    this.pendingCount += reservedSlots;

    try {
      const safeFiles: File[] = [];
      let exceededLimit = false;
      for (const file of candidates) {
        if (safeFiles.length === reservedSlots) {
          exceededLimit = true;
          break;
        }
        if (await isBlockedExecutableFile(file)) {
          toast.error(m['room.attachment.executable_not_allowed']({ filename: file.name }));
          continue;
        }
        safeFiles.push(file);
      }
      if (exceededLimit) {
        toast.error(m['room.attachment.too_many']({ max: MAX_MESSAGE_ATTACHMENTS }));
      }
      if (safeFiles.length === 0) return;

      const prepared = await prepareFiles(safeFiles);
      if (generation === this.generation && prepared.length > 0) {
        this.filesWithUrls = [...this.filesWithUrls, ...this.filesToPreviewItems(prepared)];
      }
    } catch (err) {
      console.error('Error preparing attachment files:', err);
      toast.error(m['room.attachment.prepare_failed']());
    } finally {
      this.pendingCount -= reservedSlots;
    }
  }

  removeFile(index: number): void {
    const removed = this.filesWithUrls[index];
    if (removed) URL.revokeObjectURL(removed.url);
    this.filesWithUrls = this.filesWithUrls.filter((_, i) => i !== index);
  }

  clear(): void {
    this.invalidatePending();
    for (const { url } of this.filesWithUrls) {
      URL.revokeObjectURL(url);
    }
    this.filesWithUrls = [];
  }
}
