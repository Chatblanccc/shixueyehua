import type { UploadKind } from '../../shared';

export interface UploadGrant {
  fileId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
}
export interface VerifiedMedia {
  fileSize: number;
  mimeType: string;
  duration?: number;
}
export interface AudioStoragePort {
  /** Grant only the exact server path; deadline must not exceed actual signed expiry. */
  prepare(cloudPath: string, now: Date): Promise<UploadGrant>;
  /** Read bounded real bytes, parse type/duration, copy immutable finalPath, return actual fileID. */
  inspectAndSeal(input: {
    sourceFileId: string;
    finalPath: string;
    kind: UploadKind;
    expectedBytes: number;
    maxBytes: number;
  }): Promise<VerifiedMedia & { fileId: string }>;
  temporaryUrl(fileId: string, maxAgeSeconds: number): Promise<string>;
  /** Treat already absent files as success; throw on unacknowledged failure. */
  deleteFiles(fileIds: string[]): Promise<void>;
}
