import { sha256 } from 'js-sha256';
import * as m from '$lib/i18n/messages';
import {
  AssetUploadService,
  AssetUploadStatus
} from '@towk/api-types/api/v1/asset_uploads_pb';
import type { MessageVoiceMetadata } from '@towk/api-types/api/v1/message_types_pb';
import {
  authHeaders,
  createTowkClient,
  handleAuthError,
  type ConnectAPIConfig
} from './connect.js';

export type UploadedAsset = {
  assetId: string;
  filename: string;
  contentType: string;
  size: bigint;
  width: number;
  height: number;
};

export type AttachmentUploadPhase = 'preparing' | 'uploading' | 'finalizing' | 'completed';

export type AttachmentUploadProgress = {
  phase: AttachmentUploadPhase;
  fileName: string;
  committedBytes: number;
  totalBytes: number;
};

export type UploadAttachmentOptions = {
  roomId: string;
  file: File;
  voiceMessage?: Pick<MessageVoiceMetadata, 'durationMs' | 'waveformPeaks'>;
  signal?: AbortSignal;
  onProgress?: (progress: AttachmentUploadProgress) => void;
};

const fallbackChunkSize = 512 * 1024;

export function createAssetUploadAPI(config: ConnectAPIConfig) {
  const client = createTowkClient(AssetUploadService, config);
  const headers = () => authHeaders(config);

  return {
    async uploadAttachment(options: UploadAttachmentOptions): Promise<UploadedAsset> {
      const fileName = options.file.name || 'attachment';
      const report = (phase: AttachmentUploadPhase, committedBytes: number) =>
        options.onProgress?.({
          phase,
          fileName,
          committedBytes,
          totalBytes: options.file.size
        });

      const callOptions = () =>
        options.signal
          ? { headers: headers(), signal: options.signal }
          : { headers: headers() };

      let uploadId: string | null = null;
      try {
        throwIfAborted(options.signal);
        report('preparing', 0);
        const fullHash = await fileSHA256(options.file, options.signal);
        throwIfAborted(options.signal);

        const created = await client.createUpload(
          {
            roomId: options.roomId,
            filename: fileName,
            contentType: options.file.type || 'application/octet-stream',
            size: BigInt(options.file.size),
            sha256: fullHash,
            voiceMessage: options.voiceMessage
              ? {
                  durationMs: options.voiceMessage.durationMs,
                  waveformPeaks: [...options.voiceMessage.waveformPeaks]
                }
              : undefined
          },
          callOptions()
        );
        const upload = created.upload;
        if (!upload?.uploadId) {
          throw new Error(m['common.error.unexpected_server_response']());
        }
        uploadId = upload.uploadId;

        let offset = Number(upload.committedOffset);
        if (offset < 0 || offset > options.file.size) {
          throw new Error(m['common.error.unexpected_server_response']());
        }
        const chunkSize = Math.max(1, upload.maxChunkSize || fallbackChunkSize);
        report('uploading', offset);

        let chunkRetryCount = 0;
        while (offset < options.file.size) {
          throwIfAborted(options.signal);
          const end = Math.min(offset + chunkSize, options.file.size);
          const chunk = new Uint8Array(await options.file.slice(offset, end).arrayBuffer());
          throwIfAborted(options.signal);
          try {
            const response = await client.uploadChunk(
              {
                uploadId: upload.uploadId,
                offset: BigInt(offset),
                content: chunk,
                chunkSha256: sha256(chunk)
              },
              callOptions()
            );
            const committedOffset = Number(response.upload?.committedOffset ?? BigInt(end));
            if (committedOffset <= offset || committedOffset > options.file.size) {
              throw new Error(m['common.error.unexpected_server_response']());
            }
            offset = committedOffset;
            chunkRetryCount = 0;
            report('uploading', offset);
          } catch (err) {
            throwIfAborted(options.signal);
            const resumed = await client.getUpload(
              { uploadId: upload.uploadId },
              callOptions()
            );
            const resumedOffset = Number(resumed.upload?.committedOffset ?? BigInt(offset));
            if (resumedOffset > offset && resumedOffset <= options.file.size) {
              offset = resumedOffset;
              chunkRetryCount = 0;
              report('uploading', offset);
              continue;
            }
            if (chunkRetryCount < 2) {
              chunkRetryCount += 1;
              continue;
            }
            throw err;
          }
        }

        throwIfAborted(options.signal);
        report('finalizing', options.file.size);
        try {
          const completed = await client.completeUpload(
            { uploadId: upload.uploadId },
            callOptions()
          );
          if (completed.asset?.id) {
            report('completed', options.file.size);
            return {
              assetId: completed.asset.id,
              filename: completed.asset.filename,
              contentType: completed.asset.contentType,
              size: completed.asset.size,
              width: completed.asset.width,
              height: completed.asset.height
            };
          }
          const completedAssetId = completed.upload?.assetId;
          if (
            completed.upload?.status === AssetUploadStatus.COMPLETED &&
            completedAssetId
          ) {
            report('completed', options.file.size);
            return recoveredAsset(options.file, completedAssetId);
          }
          throw new Error(m['common.error.unexpected_server_response']());
        } catch (completionError) {
          throwIfAborted(options.signal);
          try {
            const recovered = await client.getUpload(
              { uploadId: upload.uploadId },
              callOptions()
            );
            if (
              recovered.upload?.status === AssetUploadStatus.COMPLETED &&
              recovered.upload.assetId
            ) {
              report('completed', options.file.size);
              return recoveredAsset(options.file, recovered.upload.assetId);
            }
          } catch {
            // Preserve the completion error. A follow-up read is only a
            // reconciliation attempt for an ambiguous network response.
          }
          throw completionError;
        }
      } catch (err) {
        if (uploadId) {
          try {
            await client.cancelUpload({ uploadId }, { headers: headers() });
          } catch {
            // The server may already have completed, cancelled, or expired the
            // session. Cleanup remains best-effort and must not hide the cause.
          }
        }
        return handleAuthError(config, err);
      }
    }
  };
}

async function fileSHA256(file: File, signal?: AbortSignal): Promise<string> {
  const hash = sha256.create();
  const reader = file.stream().getReader();
  const cancelRead = () => void reader.cancel(signal?.reason).catch(() => undefined);
  signal?.addEventListener('abort', cancelRead, { once: true });
  try {
    for (;;) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      if (done) break;
      hash.update(value);
    }
  } finally {
    signal?.removeEventListener('abort', cancelRead);
    reader.releaseLock();
  }
  return hash.hex();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error('Upload cancelled');
  error.name = 'AbortError';
  throw error;
}

function recoveredAsset(file: File, assetId: string): UploadedAsset {
  return {
    assetId,
    filename: file.name || 'attachment',
    contentType: file.type || 'application/octet-stream',
    size: BigInt(file.size),
    width: 0,
    height: 0
  };
}
