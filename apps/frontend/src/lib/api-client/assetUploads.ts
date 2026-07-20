import { sha256 } from 'js-sha256';
import * as m from '$lib/i18n/messages';
import { AssetUploadService } from '@towk/api-types/api/v1/asset_uploads_connect';
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

export type UploadAttachmentOptions = {
  roomId: string;
  file: File;
  voiceMessage?: Pick<MessageVoiceMetadata, 'durationMs' | 'waveformPeaks'>;
  onProgress?: (committedBytes: number, totalBytes: number) => void;
};

const fallbackChunkSize = 512 * 1024;

export function createAssetUploadAPI(config: ConnectAPIConfig) {
  const client = createTowkClient(AssetUploadService, config);
  const headers = () => authHeaders(config);

  return {
    async uploadAttachment(options: UploadAttachmentOptions): Promise<UploadedAsset> {
      let uploadId: string | null = null;
      try {
        const fullHash = await fileSHA256(options.file);
        const created = await client.createUpload(
          {
            roomId: options.roomId,
            filename: options.file.name || 'attachment',
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
          { headers: headers() }
        );
        const upload = created.upload;
        if (!upload?.uploadId) {
          throw new Error(m['common.error.unexpected_server_response']());
        }
        uploadId = upload.uploadId;

        let offset = Number(upload.committedOffset);
        const chunkSize = Math.max(1, upload.maxChunkSize || fallbackChunkSize);
        options.onProgress?.(offset, options.file.size);

        let chunkRetryCount = 0;
        while (offset < options.file.size) {
          const end = Math.min(offset + chunkSize, options.file.size);
          const chunk = new Uint8Array(await options.file.slice(offset, end).arrayBuffer());
          try {
            const response = await client.uploadChunk(
              {
                uploadId: upload.uploadId,
                offset: BigInt(offset),
                content: chunk,
                chunkSha256: sha256(chunk)
              },
              { headers: headers() }
            );
            offset = Number(response.upload?.committedOffset ?? BigInt(end));
            chunkRetryCount = 0;
            options.onProgress?.(offset, options.file.size);
          } catch (err) {
            const resumed = await client.getUpload(
              { uploadId: upload.uploadId },
              { headers: headers() }
            );
            const resumedOffset = Number(resumed.upload?.committedOffset ?? BigInt(offset));
            if (resumedOffset > offset && resumedOffset <= options.file.size) {
              offset = resumedOffset;
              chunkRetryCount = 0;
              options.onProgress?.(offset, options.file.size);
              continue;
            }
            if (chunkRetryCount < 2) {
              chunkRetryCount += 1;
              continue;
            }
            throw err;
          }
        }

        const completed = await client.completeUpload(
          { uploadId: upload.uploadId },
          { headers: headers() }
        );
        if (!completed.asset?.id) {
          throw new Error(m['common.error.unexpected_server_response']());
        }
        return {
          assetId: completed.asset.id,
          filename: completed.asset.filename,
          contentType: completed.asset.contentType,
          size: completed.asset.size,
          width: completed.asset.width,
          height: completed.asset.height
        };
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

async function fileSHA256(file: File): Promise<string> {
  const hash = sha256.create();
  const reader = file.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  return hash.hex();
}
