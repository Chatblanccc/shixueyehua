import {
  parseAudioDetail,
  parseAudioPage,
  parseAudioProgress,
  parseFavoriteResult,
} from '../generated/shared';
import { callCloud } from './cloud-api';
import { localModeEnabled } from './local-mode';
import { localRepository } from './local.service';

function withLocalCover<T extends { _id: string; coverUrl?: string }>(audio: T): T {
  if (!localModeEnabled()) return audio;
  const coverUrl = localRepository().cover(audio._id);
  return coverUrl ? { ...audio, coverUrl } : audio;
}
function parsePage(value: unknown) {
  const page = parseAudioPage(value);
  return { ...page, items: page.items.map(withLocalCover) };
}

/** The server derives account and school scope; callers never send those claims. */
export const audioService = {
  list: (cursor?: string) => callCloud('audioApi', 'list', parsePage, { cursor, pageSize: 20 }),
  history: (cursor?: string) =>
    callCloud('audioApi', 'history', parsePage, { cursor, pageSize: 20 }),
  listFavorites: (cursor?: string) =>
    callCloud('audioApi', 'listFavorites', parsePage, { cursor, pageSize: 20 }),
  detail: (audioId: string, includeMedia = false) =>
    callCloud('audioApi', 'detail', (value) => withLocalCover(parseAudioDetail(value)), {
      audioId,
      includeMedia,
    }),
  toggleFavorite: (audioId: string, favorite: boolean) =>
    callCloud('audioApi', 'toggleFavorite', parseFavoriteResult, { audioId, favorite }),
  saveProgress: (audioId: string, currentTime: number) =>
    callCloud('audioApi', 'saveProgress', parseAudioProgress, { audioId, currentTime }),
};
