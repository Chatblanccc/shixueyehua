export const ERROR_MESSAGES = {
  UNAUTHORIZED: '登录状态已失效，请重新进入',
  FORBIDDEN: '当前账号没有此操作权限',
  USER_DISABLED: '当前账号暂时无法执行该操作',
  USER_DELETED: '当前账号已注销，无法继续使用',
  INVALID_ARGUMENT: '请检查填写内容',
  INVALID_RESPONSE: '服务返回异常，请稍后重试',
  SCHOOL_SCOPE_DENIED: '无法访问其他学校的数据',
  SCHOOL_NOT_AVAILABLE: '该学校当前不可使用',
  CLASS_NOT_AVAILABLE: '该班级当前不可选择',
  AUDIO_STATE_CONFLICT: '这期夜话的状态已变化，请刷新后重试',
  UPLOAD_EXPIRED: '上传凭证已过期，请重新选择文件',
  AUDIO_NOT_FOUND: '这期夜话已下架或不存在',
  UPLOAD_FAILED: '上传失败，请重试',
  CONTENT_REJECTED: '内容暂时无法提交，请修改后重试',
  LETTER_STATE_CONFLICT: '当前状态不能执行此操作',
  DUPLICATE_REQUEST: '请勿重复提交',
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  TIMEOUT: '连接超时，请重试',
  NETWORK_ERROR: '连接失败，请检查网络后重试',
  NOT_IMPLEMENTED: '该功能正在准备中',
  INTERNAL_ERROR: '系统开小差了，请稍后再试',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;
export interface ApiError {
  code: ErrorCode;
  message: string;
  requestId: string;
}

export type ApiResult<T> =
  | { success: true; data: T; requestId: string }
  | { success: false; error: ApiError; requestId: string };

export interface CloudActionRequest<TPayload = unknown> {
  action: string;
  payload?: TPayload;
  requestId?: string;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value);
}
