import { isRecord, readString } from '../../shared';
import { getDocument } from './audio-db';
function parse(value: unknown) {
  if (!isRecord(value) || !isRecord(value.value)) throw new Error('Invalid letter config');
  const enabled = value.value.enableLetterImages;
  const max = value.value.maxLetterImages;
  if (
    (enabled !== undefined && typeof enabled !== 'boolean') ||
    (max !== undefined &&
      (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 0 || max > 3))
  )
    throw new Error('Invalid letter image limits');
  return {
    _id: readString(value._id),
    enabled: enabled as boolean | undefined,
    max: max as number | undefined,
  };
}
export async function readLetterImageLimit(db: unknown, schoolId: string): Promise<number> {
  const global = await getDocument(db, 'system_configs', 'app:global', parse);
  const school = await getDocument(db, 'system_configs', `app:school:${schoolId}`, parse);
  return (school?.enabled ?? global?.enabled ?? true) ? (school?.max ?? global?.max ?? 3) : 0;
}
