import { isRecord, readString, parseAudioUploadTicket } from '../generated/shared';
import { callCloud } from './cloud-api';
import { localModeEnabled } from './local-mode';
const fileResult = (v: unknown) => {
  if (!isRecord(v)) throw new Error('图片回执无效');
  return readString(v.fileId, 1024);
};
export async function letterImageUrls(letterId: string, fileIds: string[]): Promise<string[]> {
  if (!fileIds.length) return [];
  return callCloud(
    'letterApi',
    'imageUrls',
    (v) => {
      if (!isRecord(v) || !Array.isArray(v.urls) || v.urls.length !== fileIds.length)
        throw new Error('图片预览不可用');
      return v.urls.map((url: unknown) => readString(url, 4096));
    },
    { letterId, fileIds },
  );
}
export class LetterImageUpload {
  private cancelled = false;
  private task?: WechatMiniprogram.RequestTask;
  cancel() {
    this.cancelled = true;
    this.task?.abort();
  }
  private active() {
    if (this.cancelled) throw new Error('图片上传已取消');
  }
  async run(letterId: string, revision: number, phase: (v: string) => void): Promise<string> {
    let ticketId = '';
    let localFile = '';
    try {
      phase('选择图片');
      const selected = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
      });
      this.active();
      const first = selected.tempFiles[0];
      if (!first) throw new Error('未选择图片');
      phase('压缩图片');
      const compressed = await wx.compressImage({ src: first.tempFilePath, quality: 75 });
      this.active();
      const path = compressed.tempFilePath;
      const info = await wx.getImageInfo({ src: path });
      const extension = info.type === 'jpeg' ? 'jpg' : info.type;
      if (!['jpg', 'png'].includes(extension)) throw new Error('请选择 JPG 或 PNG 图片');
      const fs = wx.getFileSystemManager();
      const size = await new Promise<number>((resolve, reject) =>
        fs.getFileInfo({ filePath: path, success: (v) => resolve(v.size), fail: reject }),
      );
      if (size < 1 || size > 5 * 1024 * 1024) throw new Error('图片压缩后仍超过 5MB，请换一张');
      this.active();
      if (localModeEnabled()) {
        phase('保存图片到本机');
        const saved = await new Promise<string>((resolve, reject) =>
          fs.saveFile({
            tempFilePath: path,
            success: (v) => resolve(v.savedFilePath),
            fail: reject,
          }),
        );
        localFile = saved;
        this.active();
        const fileId = await callCloud('letterApi', 'storeLocalImage', fileResult, {
          letterId,
          revision,
          localPath: saved,
        });
        localFile = '';
        return fileId;
      }
      phase('获取上传许可');
      await callCloud('letterApi', 'cleanupImages', (v) => v, { letterId });
      const ticket = await callCloud('letterApi', 'prepareImage', parseAudioUploadTicket, {
        letterId,
        revision,
        fileName: `letter.${extension}`,
        fileSize: size,
      });
      ticketId = ticket.ticketId;
      this.active();
      if (size > ticket.maxBytes || Date.parse(ticket.expiresAt) <= Date.now())
        throw new Error('上传许可已过期');
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) =>
        fs.readFile({
          filePath: path,
          success: (v) =>
            typeof v.data === 'string' ? reject(new Error('读取图片失败')) : resolve(v.data),
          fail: reject,
        }),
      );
      this.active();
      phase('传输图片');
      await new Promise<void>((resolve, reject) => {
        this.task = wx.request({
          url: ticket.uploadUrl,
          method: 'PUT',
          header: ticket.headers,
          data: bytes,
          timeout: 120000,
          success: (v) => (v.statusCode === 200 ? resolve() : reject(new Error('图片传输失败'))),
          fail: () => reject(new Error('图片传输中断，请重试')),
        });
      });
      this.active();
      phase('校验图片文件');
      const fileId = await callCloud('letterApi', 'confirmImage', fileResult, {
        letterId,
        ticketId,
      });
      this.active();
      return fileId;
    } catch (error) {
      if (localFile)
        await new Promise<void>((resolve) =>
          wx.getFileSystemManager().removeSavedFile({
            filePath: localFile,
            success: () => resolve(),
            fail: () => resolve(),
          }),
        );
      if (ticketId)
        await callCloud('letterApi', 'cancelImage', (v) => v, { letterId, ticketId }).catch(
          () => undefined,
        );
      throw error;
    }
  }
}
