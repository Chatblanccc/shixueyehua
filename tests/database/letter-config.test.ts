import { describe, expect, it } from 'vitest';
import { readLetterImageLimit } from '../../cloudfunctions/_shared/letter-config';
const db = (values: Record<string, unknown>) => ({
  collection: () => ({
    doc: (id: string) => ({
      get: async () => ({ data: id in values ? { _id: id, value: values[id] } : null }),
    }),
  }),
});
describe('letter image configuration', () => {
  it('merges defaults, global settings and school overrides', async () => {
    expect(await readLetterImageLimit(db({}), 'school')).toBe(3);
    expect(await readLetterImageLimit(db({ 'app:global': { maxLetterImages: 2 } }), 'school')).toBe(
      2,
    );
    expect(
      await readLetterImageLimit(
        db({
          'app:global': { maxLetterImages: 2 },
          'app:school:school': { enableLetterImages: false },
        }),
        'school',
      ),
    ).toBe(0);
  });
  it.each([{ maxLetterImages: 4 }, { maxLetterImages: -1 }, { enableLetterImages: 'true' }])(
    'fails closed on malformed config %#',
    async (value) => {
      await expect(readLetterImageLimit(db({ 'app:global': value }), 'school')).rejects.toThrow();
    },
  );
});
