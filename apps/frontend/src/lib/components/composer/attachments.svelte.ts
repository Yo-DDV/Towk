import { toast } from '$lib/ui/toast';
import { prepareFiles } from '$lib/attachments/prepareFiles';
import {
  applyImageQuality,
  isQualityAdjustableImage,
  loadImageQualityProfile,
  saveImageQualityProfile,
  type ImageQualityProfile
} from '$lib/attachments/imageQuality';
import {
  hasBlockedExecutableMetadata,
  hasUnsafeAttachmentFilename,
  inferredVideoAttachmentContentType,
  isBlockedExecutableFile,
  isVideoAttachmentFileCandidate,
  MAX_MESSAGE_ATTACHMENTS
} from '$lib/attachments/filePolicy';
import * as m from '$lib/i18n/messages';

export type FileWithUrl = {
  file: File;
  url: string;
  /** Source file kept so the quality profile can be changed after staging. */
  sourceFile?: File;
};

export type AttachmentLimits = {
  maxUploadSize: number;
  maxVideoUploadSize: number;
};

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} bytes`;
}

function fileWithInferredVideoContentType(file: File): File {
  const contentType = inferredVideoAttachmentContentType(file);
  if (!contentType || file.type === contentType) return file;
  return new File([file], file.name, { type: contentType, lastModified: file.lastModified });
}

export class AttachmentsState {
  filesWithUrls = $state<FileWithUrl[]>([]);
  pendingCount = $state(0);
  imageQuality = $state<ImageQualityProfile>(loadImageQualityProfile());
  /** True while staged images are being re-encoded for a new profile. */
  imageQualityBusy = $state(false);
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

      const isVideo = isVideoAttachmentFileCandidate(file);
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

  filesToPreviewItems(files: File[], sourceFiles?: File[]): FileWithUrl[] {
    return files.map((file, index) => {
      const previewFile = fileWithInferredVideoContentType(file);
      return {
        file: previewFile,
        url: URL.createObjectURL(previewFile),
        sourceFile: sourceFiles?.[index] ?? file
      };
    });
  }

  /** True when at least one staged attachment can be re-encoded. */
  get hasQualityAdjustableImages(): boolean {
    return this.filesWithUrls.some(({ file, sourceFile }) =>
      isQualityAdjustableImage(sourceFile ?? file)
    );
  }

  /** Total size of the files that would be uploaded right now. */
  get stagedBytes(): number {
    return this.filesWithUrls.reduce((total, { file }) => total + file.size, 0);
  }

  /** Total size of the same attachments before any re-encoding. */
  get sourceBytes(): number {
    return this.filesWithUrls.reduce(
      (total, { file, sourceFile }) => total + (sourceFile ?? file).size,
      0
    );
  }

  /**
   * Applies a quality profile to every staged image. Each preview is rebuilt
   * from its source file, so switching back to the original profile restores
   * the untouched attachment.
   */
  async setImageQuality(profile: ImageQualityProfile): Promise<void> {
    if (profile === this.imageQuality) return;
    this.imageQuality = profile;
    saveImageQualityProfile(profile);
    if (this.filesWithUrls.length === 0) return;

    const generation = this.generation;
    const sources = this.filesWithUrls.map(({ file, sourceFile }) => sourceFile ?? file);
    this.imageQualityBusy = true;
    let prepared: File[];
    try {
      prepared = await Promise.all(sources.map((file) => applyImageQuality(file, profile)));
    } finally {
      if (generation === this.generation) this.imageQualityBusy = false;
    }
    if (generation !== this.generation) return;

    for (const { url } of this.filesWithUrls) URL.revokeObjectURL(url);
    this.filesWithUrls = this.filesToPreviewItems(prepared, sources);
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
      const encoded = await Promise.all(
        prepared.map((file) => applyImageQuality(file, this.imageQuality))
      );
      if (generation === this.generation && encoded.length > 0) {
        this.filesWithUrls = [
          ...this.filesWithUrls,
          ...this.filesToPreviewItems(encoded, prepared)
        ];
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
