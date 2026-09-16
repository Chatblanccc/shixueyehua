export interface IndexDefinition {
  name: string;
  unique: boolean;
  keys: ReadonlyArray<{ name: string; direction: '1' | '-1' }>;
}

export interface CollectionDefinition {
  name: string;
  indexes: ReadonlyArray<IndexDefinition>;
}

function index(name: string, fields: readonly string[], unique = false): IndexDefinition {
  return {
    name,
    unique,
    keys: fields.map((field) => ({
      name: field.startsWith('-') ? field.slice(1) : field,
      direction: field.startsWith('-') ? '-1' : '1',
    })),
  };
}

/** TASK-102; existing indexes are compared, never automatically dropped. */
export const DATABASE_MANIFEST: ReadonlyArray<CollectionDefinition> = [
  {
    name: 'media_safety_jobs',
    indexes: [
      index('app_trace_unique', ['appId', 'traceId'], true),
      index('letter_revision', ['letterId', 'revision']),
      index('expires', ['expiresAt']),
    ],
  },
  {
    name: 'users',
    indexes: [
      index('openid_unique', ['openid'], true),
      index('role_admin_school', ['role', 'adminSchoolId']),
      index('status', ['status']),
    ],
  },
  { name: 'schools', indexes: [index('status', ['status'])] },
  { name: 'grades', indexes: [index('school_status_order', ['schoolId', 'status', 'sortOrder'])] },
  { name: 'classes', indexes: [index('school_grade_status', ['schoolId', 'gradeId', 'status'])] },
  {
    name: 'class_memberships',
    indexes: [
      index('user_class_unique', ['userId', 'classId'], true),
      index('school_class_status', ['schoolId', 'classId', 'status']),
    ],
  },
  {
    name: 'audio_programs',
    indexes: [
      index('school_status_published', ['schoolId', 'status', '-publishedAt']),
      index('class_ids', ['classIds']),
      index('deleted_at', ['deletedAt']),
      index('school_published_cursor', ['schoolId', 'status', 'deletedAt', '-publishedAt', '-_id']),
      index('school_created_cursor', ['schoolId', 'status', 'deletedAt', '-createdAt', '-_id']),
    ],
  },
  {
    name: 'play_progress',
    indexes: [
      index('user_audio_unique', ['userId', 'audioId'], true),
      index('user_updated', ['userId', '-updatedAt']),
      index('user_progress_cursor', ['userId', 'deletedAt', '-updatedAt', '-_id']),
    ],
  },
  {
    name: 'favorites',
    indexes: [
      index('user_audio_unique', ['userId', 'audioId'], true),
      index('user_created', ['userId', '-createdAt']),
      index('user_favorite_cursor', ['userId', 'deletedAt', '-createdAt', '-_id']),
    ],
  },
  {
    name: 'audio_uploads',
    indexes: [index('school_cleanup', ['schoolId', 'status', 'grantExpiresAt', '_id'])],
  },
  { name: 'audio_upload_quotas', indexes: [] },
  {
    name: 'letters',
    indexes: [
      index('school_review_published', ['schoolId', 'reviewStatus', '-publishedAt']),
      index('author_updated', ['authorId', '-updatedAt']),
    ],
  },
  {
    name: 'reports',
    indexes: [
      index('target_reporter', ['targetType', 'targetId', 'reporterId']),
      index('status_created', ['status', 'createdAt']),
    ],
  },
  {
    name: 'admin_logs',
    indexes: [
      index('school_created', ['schoolId', '-createdAt']),
      index('operator_created', ['operatorId', '-createdAt']),
    ],
  },
  { name: 'system_configs', indexes: [] },
  { name: 'notifications', indexes: [index('user_created', ['userId', '-createdAt'])] },
];

export const DENY_CLIENT_ACCESS = Object.freeze({ read: false, write: false });

export function sameIndex(a: IndexDefinition, b: IndexDefinition): boolean {
  return a.unique === b.unique && JSON.stringify(a.keys) === JSON.stringify(b.keys);
}
