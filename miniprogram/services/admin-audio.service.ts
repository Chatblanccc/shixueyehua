import {
  parseManagedAudio,
  parseManagedAudioPage,
  parseAudioUploadTicket,
  parseConfirmedAudioUpload,
  isRecord,
} from '../generated/shared';
import type { AudioDraftInput, AudioDraftUpdateInput, UploadKind } from '../generated/shared';
import { callCloud } from './cloud-api';
import { localModeEnabled } from './local-mode';
import { localRepository } from './local.service';
import { SAMPLE_PATH, SAMPLE_DURATION } from './local-repository';

export interface SelectedMedia {
  path: string;
  name: string;
  size: number;
  duration?: number;
  ticketId?: string;
}
export const adminAudioService = {
  list: (schoolId: string, status?: 'draft' | 'published' | 'offline', cursor?: string) =>
    callCloud('adminAudioApi', 'listManage', parseManagedAudioPage, {
      schoolId,
      status,
      cursor,
      pageSize: 20,
    }),
  detail: (audioId: string) =>
    callCloud('adminAudioApi', 'detail', parseManagedAudio, { audioId, includeMedia: true }),
  create: (input: AudioDraftInput, audio: SelectedMedia, cover?: SelectedMedia) =>
    callCloud('adminAudioApi', 'createDraft', parseManagedAudio, {
      ...input,
      ...(localModeEnabled()
        ? {
            localPath: audio.path,
            localDuration: audio.duration,
            localBytes: audio.size,
            localCover: cover?.path,
          }
        : {}),
    }),
  update: (input: AudioDraftUpdateInput, audio?: SelectedMedia, cover?: SelectedMedia) =>
    callCloud('adminAudioApi', 'updateDraft', parseManagedAudio, {
      ...input,
      ...(localModeEnabled()
        ? {
            ...(audio
              ? { localPath: audio.path, localDuration: audio.duration, localBytes: audio.size }
              : {}),
            ...(cover ? { localCover: cover.path } : {}),
          }
        : {}),
    }),
  transition: (audioId: string, action: 'publish' | 'offline' | 'delete') =>
    callCloud('adminAudioApi', action, parseManagedAudio, { audioId }),
};
export function sampleMedia(): SelectedMedia {
  if (!localModeEnabled()) throw new Error('仅限本地体验');
  return { path: SAMPLE_PATH, name: '校园夜话示例.m4a', size: 196018, duration: SAMPLE_DURATION };
}
export function mediaPath(url: string): string {
  return localModeEnabled() ? localRepository().media(url) : url;
}

export function mediaDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const player = wx.createInnerAudioContext();
    let settled = false;
    const finish = (duration?: number) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      player.destroy();
      if (duration && Number.isFinite(duration) && duration > 0 && duration <= 14400)
        resolve(duration);
      else reject(new Error('无法读取音频时长，请选择有效的 MP3 或 M4A 文件'));
    };
    const poll = setInterval(() => {
      if (player.duration > 0) finish(player.duration);
    }, 100);
    const timeout = setTimeout(() => finish(), 10000);
    player.onError(() => finish());
    player.src = path;
  });
}
export async function chooseAudio(): Promise<SelectedMedia> {
  const selected = await wx.chooseMessageFile({
    count: 1,
    type: 'file',
    extension: ['mp3', 'm4a'],
  });
  const file = selected.tempFiles[0];
  if (!file || !/\.(mp3|m4a)$/i.test(file.name) || file.size <= 0 || file.size > 50 * 1024 * 1024)
    throw new Error('请选择不超过 50MB 的 MP3 或 M4A 音频');
  return { path: file.path, name: file.name, size: file.size };
}
export async function chooseCover(): Promise<SelectedMedia> {
  const result = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] });
  const first = result.tempFiles[0];
  if (!first) throw new Error('未选择图片');
  const compressed = await wx.compressImage({ src: first.tempFilePath, quality: 75 });
  const path = compressed.tempFilePath;
  const info = await new Promise<{ size: number }>((resolve, reject) =>
    wx.getFileSystemManager().getFileInfo({ filePath: path, success: resolve, fail: reject }),
  );
  if (info.size > 5 * 1024 * 1024) throw new Error('封面压缩后仍超过 5MB，请换一张图片');
  const image = await wx.getImageInfo({ src: path });
  const ext = image.type === 'jpeg' ? 'jpg' : image.type;
  if (!['jpg', 'png', 'webp'].includes(ext)) throw new Error('请选择 JPG、PNG 或 WebP 封面');
  return { path, name: `cover.${ext}`, size: info.size };
}

/** A cancelable upload; progress describes actual phases, never invented network percentages. */
export class MediaUpload {
  private cancelled = false;
  private task: WechatMiniprogram.RequestTask | undefined;
  private ticket = '';
  cancel(): void {
    this.cancelled = true;
    this.task?.abort();
  }
  private check(): void {
    if (this.cancelled) throw new Error('上传已取消，可重新选择文件');
  }
  async run(
    file: SelectedMedia,
    schoolId: string,
    kind: UploadKind,
    phase: (value: string) => void,
  ): Promise<SelectedMedia> {
    try {
      this.check();
      if (localModeEnabled()) {
        phase('正在保存到本机…');
        const duration = kind === 'audio' ? await mediaDuration(file.path) : undefined;
        this.check();
        const saved = await new Promise<{ savedFilePath: string }>((resolve, reject) =>
          wx
            .getFileSystemManager()
            .saveFile({ tempFilePath: file.path, success: resolve, fail: reject }),
        );
        this.check();
        return { ...file, path: saved.savedFilePath, ...(duration ? { duration } : {}) };
      }
      phase('正在获取上传许可…');
      const ticket = await callCloud('adminAudioApi', 'prepareUpload', parseAudioUploadTicket, {
        schoolId,
        kind,
        fileName: file.name,
        fileSize: file.size,
      });
      this.ticket = ticket.ticketId;
      this.check();
      if (file.size > ticket.maxBytes || Date.parse(ticket.expiresAt) <= Date.now())
        throw new Error('上传许可已失效或文件超过限制，请重试');
      phase('正在读取文件…');
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) =>
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          success: (result) =>
            typeof result.data === 'string'
              ? reject(new Error('文件读取失败'))
              : resolve(result.data),
          fail: reject,
        }),
      );
      this.check();
      phase('正在传输文件…');
      await new Promise<void>((resolve, reject) => {
        this.task = wx.request({
          url: ticket.uploadUrl,
          method: 'PUT',
          header: ticket.headers,
          data: bytes,
          timeout: 120000,
          success: (response) =>
            response.statusCode === 200 ? resolve() : reject(new Error('上传失败，请重试')),
          fail: () => reject(new Error(this.cancelled ? '上传已取消' : '网络中断，请重试')),
        });
      });
      this.check();
      phase('正在校验实际文件…');
      const confirmed = await callCloud(
        'adminAudioApi',
        'confirmUpload',
        parseConfirmedAudioUpload,
        { ticketId: ticket.ticketId },
      );
      this.check();
      return { ...file, ticketId: confirmed.ticketId, duration: confirmed.duration };
    } catch (error: unknown) {
      if (this.ticket)
        await callCloud(
          'adminAudioApi',
          'cancelUpload',
          (v) => {
            if (!isRecord(v) || v.cancelled !== true) throw new Error('无效取消回执');
            return v;
          },
          { ticketId: this.ticket },
        ).catch(() => undefined);
      throw error;
    }
  }
}
