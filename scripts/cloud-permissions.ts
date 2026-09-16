/** Least privilege: only the letter domain needs WeChat content-safety APIs. */
export function cloudPermissions(name: string): string[] {
  return name === 'letterApi' ? ['security.msgSecCheck', 'security.mediaCheckAsync'] : [];
}
