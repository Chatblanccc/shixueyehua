import { createAdminPage } from '../../admin-page';

Page(
  createAdminPage({
    destinations: [
      'audio-create',
      'audio-manage',
      'letter-review',
      'class-manage',
      'admin-manage',
      'settings',
    ],
  }),
);
