export interface PresignUploadInput {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}

export interface PresignResult {
  uploadUrl: string;
  key: string;
  expiresAt: Date;
}

export interface StorageProvider {
  readonly name: string;
  createPresignedUpload(input: PresignUploadInput): Promise<PresignResult>;
  createPresignedDownload(key: string, expiresInSeconds?: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
