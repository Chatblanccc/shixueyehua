import type { AudioStatus, CursorPage, Visibility } from './domain';
import { isRecord, readEnum, readString } from './validate';

export interface AudioProgress {
  audioId: string;
  currentTime: number;
  duration: number;
  completed: boolean;
  updatedAt: string;
}
export interface AudioSummary {
  _id: string;
  schoolId: string;
  title: string;
  speakerName: string;
  speakerTitle: string;
  coverUrl?: string;
  duration: number;
  publishedAt: string;
  progress: AudioProgress | null;
  favorite: boolean;
}
export interface AudioDetail extends AudioSummary {
  description: string;
  mediaUrl?: string;
  mediaExpiresAt?: string;
  previousAudioId?: string;
  nextAudioId?: string;
}
export interface AudioListInput {
  cursor?: string;
  pageSize?: number;
}
export interface AudioDetailInput {
  audioId: string;
  includeMedia?: boolean;
}
export interface SaveProgressInput {
  audioId: string;
  currentTime: number;
}
export interface SetFavoriteInput {
  audioId: string;
  favorite: boolean;
}
export interface FavoriteResult {
  audioId: string;
  favorite: boolean;
}
export type UploadKind = 'audio' | 'cover';
export interface PrepareAudioUploadInput {
  schoolId: string;
  kind: UploadKind;
  fileName: string;
  fileSize: number;
}
/** PUT the raw bytes with these headers. Authorization is path scoped, never global. */
export interface AudioUploadTicket {
  ticketId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
}
export interface ConfirmedAudioUpload {
  ticketId: string;
  kind: UploadKind;
  fileSize: number;
  mimeType: string;
  duration?: number;
}
export interface AudioDraftInput {
  schoolId: string;
  title: string;
  description: string;
  speakerName: string;
  speakerTitle: string;
  visibility: Visibility;
  classIds: string[];
  audioTicketId: string;
  coverTicketId?: string;
}
export interface AudioDraftUpdateInput extends Omit<AudioDraftInput, 'schoolId' | 'audioTicketId'> {
  audioId: string;
  audioTicketId?: string;
  /** Explicit true chooses the built-in cover and detaches an old cover. */
  useDefaultCover?: boolean;
}
export interface ManagedAudio {
  _id: string;
  schoolId: string;
  title: string;
  description: string;
  speakerName: string;
  speakerTitle: string;
  visibility: Visibility;
  classIds: string[];
  status: AudioStatus;
  coverUrl?: string;
  duration: number;
  fileSize: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  mediaUrl?: string;
  mediaExpiresAt?: string;
}
export interface ManageAudioListInput extends AudioListInput {
  schoolId: string;
  status?: Exclude<AudioStatus, 'deleted'>;
}
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid audio string');
  return value;
}
function number(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error('Invalid audio number');
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid audio boolean');
  return value;
}
function iso(value: unknown): string {
  const result = readString(value, 30);
  if (new Date(result).toISOString() !== result) throw new Error('Invalid audio date');
  return result;
}
function url(value: unknown): string {
  const result = readString(value, 8192);
  if (!/^https:\/\/[^\s]+$/.test(result)) throw new Error('Invalid media URL');
  return result;
}
export function parseAudioProgress(value: unknown): AudioProgress {
  if (!isRecord(value)) throw new Error('Invalid audio progress');
  const duration = number(value.duration, 0.001, 14400);
  return {
    audioId: readString(value.audioId),
    currentTime: number(value.currentTime, 0, duration),
    duration,
    completed: bool(value.completed),
    updatedAt: iso(value.updatedAt),
  };
}
export function parseFavoriteResult(value: unknown): FavoriteResult {
  if (!isRecord(value)) throw new Error('Invalid favorite');
  return { audioId: readString(value.audioId), favorite: bool(value.favorite) };
}
export function parseAudioSummary(value: unknown): AudioSummary {
  if (!isRecord(value)) throw new Error('Invalid audio');
  const result: AudioSummary = {
    _id: readString(value._id),
    schoolId: readString(value.schoolId),
    title: readString(value.title, 120),
    speakerName: readString(value.speakerName, 80),
    speakerTitle: string(value.speakerTitle, 80),
    duration: number(value.duration, 0.001, 14400),
    publishedAt: iso(value.publishedAt),
    progress: value.progress === null ? null : parseAudioProgress(value.progress),
    favorite: bool(value.favorite),
  };
  if (result.progress && result.progress.audioId !== result._id)
    throw new Error('Progress audio mismatch');
  if (value.coverUrl !== undefined) result.coverUrl = url(value.coverUrl);
  return result;
}
export function parseAudioDetail(value: unknown): AudioDetail {
  if (!isRecord(value)) throw new Error('Invalid audio detail');
  const result: AudioDetail = {
    ...parseAudioSummary(value),
    description: string(value.description, 2000),
  };
  if (value.mediaUrl !== undefined) {
    result.mediaUrl = url(value.mediaUrl);
    result.mediaExpiresAt = iso(value.mediaExpiresAt);
  }
  for (const field of ['previousAudioId', 'nextAudioId'] as const)
    if (value[field] !== undefined) result[field] = readString(value[field]);
  return result;
}
function page<T>(value: unknown, parse: (item: unknown) => T): CursorPage<T> {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 100)
    throw new Error('Invalid audio page');
  const result: CursorPage<T> = { items: value.items.map(parse) };
  if (value.nextCursor !== undefined) result.nextCursor = readString(value.nextCursor, 2048);
  return result;
}
export function parseAudioPage(value: unknown): CursorPage<AudioSummary> {
  return page(value, parseAudioSummary);
}
export function parseManagedAudio(value: unknown): ManagedAudio {
  if (!isRecord(value) || !Array.isArray(value.classIds) || value.classIds.length > 100)
    throw new Error('Invalid managed audio');
  const result: ManagedAudio = {
    _id: readString(value._id),
    schoolId: readString(value.schoolId),
    title: readString(value.title, 120),
    description: string(value.description, 2000),
    speakerName: readString(value.speakerName, 80),
    speakerTitle: string(value.speakerTitle, 80),
    visibility: readEnum(value.visibility, ['school', 'classes']),
    classIds: value.classIds.map((id) => readString(id)),
    status: readEnum(value.status, ['draft', 'published', 'offline', 'deleted']),
    duration: number(value.duration, 0.001, 14400),
    fileSize: number(value.fileSize, 1),
    mimeType: readString(value.mimeType, 100),
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
  };
  if (value.publishedAt !== undefined) result.publishedAt = iso(value.publishedAt);
  if (value.coverUrl !== undefined) result.coverUrl = url(value.coverUrl);
  if (value.mediaUrl !== undefined) {
    result.mediaUrl = url(value.mediaUrl);
    result.mediaExpiresAt = iso(value.mediaExpiresAt);
  }
  return result;
}
export function parseManagedAudioPage(value: unknown): CursorPage<ManagedAudio> {
  return page(value, parseManagedAudio);
}
export function parseAudioUploadTicket(value: unknown): AudioUploadTicket {
  if (!isRecord(value) || !isRecord(value.headers)) throw new Error('Invalid upload ticket');
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value.headers))
    headers[readString(key, 100)] = readString(entry, 8192);
  return {
    ticketId: readString(value.ticketId),
    uploadUrl: url(value.uploadUrl),
    method: readEnum(value.method, ['PUT']),
    headers,
    expiresAt: iso(value.expiresAt),
    maxBytes: number(value.maxBytes, 1),
  };
}
export function parseConfirmedAudioUpload(value: unknown): ConfirmedAudioUpload {
  if (!isRecord(value)) throw new Error('Invalid confirmed upload');
  const result: ConfirmedAudioUpload = {
    ticketId: readString(value.ticketId),
    kind: readEnum(value.kind, ['audio', 'cover']),
    fileSize: number(value.fileSize, 1),
    mimeType: readString(value.mimeType, 100),
  };
  if (value.duration !== undefined) result.duration = number(value.duration, 0.001, 14400);
  return result;
}
