import type {
  AudioProgram,
  AudioStatus,
  Favorite,
  PlayProgress,
  RecordDates,
  UploadKind,
} from '../../shared';
export interface AudioPosition {
  time: Date;
  id: string;
}
export interface AudioQuery {
  schoolId: string;
  classId?: string;
  status?: AudioStatus;
  visibleOnly?: boolean;
  before?: AudioPosition;
  after?: AudioPosition;
  snapshot: Date;
  limit: number;
}
export interface PersonalAudioQuery {
  userId: string;
  before?: AudioPosition;
  snapshot: Date;
  limit: number;
}
export interface AudioUploadRecord extends RecordDates {
  _id: string;
  userId: string;
  schoolId: string;
  kind: UploadKind;
  status: 'issued' | 'validating' | 'confirmed' | 'bound' | 'cancelled' | 'cleaned';
  originalFileName: string;
  expectedBytes: number;
  maxBytes: number;
  sourcePath: string;
  sourceFileId: string;
  finalPath: string;
  finalFileId: string;
  expiresAt: Date;
  grantExpiresAt: Date;
  validationStartedAt?: Date;
  fileSize?: number;
  mimeType?: string;
  duration?: number;
  audioId?: string;
  sourceCleaned?: boolean;
  finalCleaned?: boolean;
}
export interface UploadQuota {
  _id: string;
  ticketIds: string[];
}
export interface AudioReader {
  findAudio(id: string): Promise<AudioProgram | undefined>;
  findProgress(id: string): Promise<PlayProgress | undefined>;
  findFavorite(id: string): Promise<Favorite | undefined>;
  findUpload(id: string): Promise<AudioUploadRecord | undefined>;
}
export interface AudioTransaction extends AudioReader {
  saveAudio(value: AudioProgram, exists: boolean): Promise<void>;
  saveProgress(value: PlayProgress, exists: boolean): Promise<void>;
  saveFavorite(value: Favorite, exists: boolean): Promise<void>;
  saveUpload(value: AudioUploadRecord, exists: boolean): Promise<void>;
  findUploadQuota(id: string): Promise<UploadQuota | undefined>;
  saveUploadQuota(value: UploadQuota, exists: boolean): Promise<void>;
}
export interface AudioRepository extends AudioReader {
  listAudio(query: AudioQuery): Promise<AudioProgram[]>;
  listProgress(query: PersonalAudioQuery): Promise<PlayProgress[]>;
  listFavorites(query: PersonalAudioQuery): Promise<Favorite[]>;
  listCleanupUploads(schoolId: string, before: Date, limit: number): Promise<AudioUploadRecord[]>;
}
