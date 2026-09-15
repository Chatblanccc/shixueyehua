/** Database records use server-created Date values; API responses use explicit DTOs. */
export const USER_IDENTITIES = ['student', 'parent', 'teacher'] as const;
export const USER_ROLES = ['user', 'admin', 'super_admin'] as const;
export const USER_STATUSES = ['active', 'disabled', 'deleted'] as const;
export type UserIdentity = (typeof USER_IDENTITIES)[number];
export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];

export interface RecordDates {
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  deletedBy?: string;
}

export interface User extends RecordDates {
  _id: string;
  openid: string;
  nickname: string;
  avatarFileId?: string;
  identity?: UserIdentity;
  role: UserRole;
  /** Trusted administrator authorization. Never modified by user-selected class. */
  adminSchoolId?: string;
  currentSchoolId?: string;
  currentGradeId?: string;
  currentClassId?: string;
  status: UserStatus;
}

/** The current user's private profile DTO. OpenID is never sent to the client. */
export interface UserProfile {
  _id: string;
  nickname: string;
  avatarFileId?: string;
  identity?: UserIdentity;
  role: UserRole;
  adminSchoolId?: string;
  currentSchoolId?: string;
  currentGradeId?: string;
  currentClassId?: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export type OnboardingStep = 'identity' | 'class' | 'ready';
export interface LoginResult {
  user: UserProfile;
  onboardingStep: OnboardingStep;
}

export interface School extends RecordDates {
  _id: string;
  name: string;
  logoFileId?: string;
  status: 'active' | 'disabled';
}

export interface Grade extends RecordDates {
  _id: string;
  schoolId: string;
  name: string;
  sortOrder: number;
  status: 'active' | 'disabled';
}

export type JoinMode = 'free' | 'code' | 'approval';
export interface Class extends RecordDates {
  _id: string;
  schoolId: string;
  gradeId: string;
  name: string;
  joinMode: JoinMode;
  status: 'active' | 'disabled' | 'graduated';
}

export interface ClassMembership extends RecordDates {
  _id: string;
  userId: string;
  schoolId: string;
  classId: string;
  identity: UserIdentity;
  status: 'active' | 'left';
}

export type AudioStatus = 'draft' | 'published' | 'offline' | 'deleted';
export type Visibility = 'school' | 'classes';
export interface AudioProgram extends RecordDates {
  _id: string;
  schoolId: string;
  classIds: string[];
  title: string;
  description: string;
  speakerName: string;
  speakerTitle: string;
  coverFileId: string;
  audioFileId: string;
  originalFileName?: string;
  mimeType?: string;
  fileSize: number;
  duration: number;
  visibility: Visibility;
  status: AudioStatus;
  createdBy: string;
  publishedBy?: string;
  publishedAt?: Date;
  offlineAt?: Date;
}

export interface PlayProgress extends RecordDates {
  _id: string;
  userId: string;
  schoolId: string;
  audioId: string;
  currentTime: number;
  duration: number;
  completed: boolean;
}

export interface Favorite extends RecordDates {
  _id: string;
  userId: string;
  schoolId: string;
  audioId: string;
}

export type RecipientType = 'child' | 'parent' | 'teacher' | 'classmate' | 'future_self' | 'other';
export type LetterStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'hidden' | 'deleted';
export interface ContentSafetySummary {
  decision: 'pass' | 'review' | 'reject';
  checkedAt: Date;
  provider: string;
  traceId?: string;
}

export interface Letter extends RecordDates {
  _id: string;
  authorId: string;
  schoolId: string;
  gradeId: string;
  classId: string;
  title: string;
  recipientType: RecipientType;
  content: string;
  imageFileIds: string[];
  visibility: 'private' | 'class' | 'school';
  reviewStatus: LetterStatus;
  reviewReason?: string;
  safetyResult?: ContentSafetySummary;
  reviewedBy?: string;
  reviewedAt?: Date;
  publishedAt?: Date;
}

export type ReportReason = 'privacy' | 'abuse' | 'harmful' | 'advertising' | 'other';
export interface Report extends RecordDates {
  _id: string;
  reporterId: string;
  schoolId: string;
  targetType: 'letter';
  targetId: string;
  reason: ReportReason;
  detail?: string;
  status: 'pending' | 'handled' | 'ignored';
  handledBy?: string;
  handledAt?: Date;
}

export interface SystemConfig {
  schoolId?: string;
  letterPublishMode: 'private' | 'reviewed_showcase' | 'community';
  enableLetterImages: boolean;
  maxLetterImages: number;
  reportAutoHideThreshold: number;
  enableClassApproval: boolean;
  enableComments: false;
  enablePrivateMessage: false;
  enablePayment: false;
  maintenanceMode: boolean;
}

export type SystemConfigValue = Omit<SystemConfig, 'schoolId'>;
export interface SystemConfigRecord extends RecordDates {
  _id: string;
  key: 'app';
  schoolId?: string;
  value: SystemConfigValue | Partial<SystemConfigValue>;
  updatedBy: string;
}

export const DEFAULT_SYSTEM_CONFIG: Readonly<SystemConfigValue> = Object.freeze({
  letterPublishMode: 'reviewed_showcase',
  enableLetterImages: true,
  maxLetterImages: 3,
  reportAutoHideThreshold: 3,
  enableClassApproval: false,
  enableComments: false,
  enablePrivateMessage: false,
  enablePayment: false,
  maintenanceMode: false,
});

export type AuditSnapshot = Record<string, string | number | boolean | null>;
export interface AdminLog {
  _id: string;
  operatorId: string;
  /** Stored only in the protected audit collection, never console output. */
  operatorOpenid: string;
  schoolId?: string;
  action: string;
  targetType: string;
  targetId: string;
  before: AuditSnapshot;
  after: AuditSnapshot;
  requestId: string;
  createdAt: Date;
}

export interface Notification extends RecordDates {
  _id: string;
  userId: string;
  schoolId: string;
  type: 'letter_review';
  title: string;
  targetId: string;
  readAt?: Date;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}
