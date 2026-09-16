# 实学夜话 Codex Rules

## Read first

- Read `docs/PRD.md`, `docs/CODEX_TASKS.md`, and `docs/implementation-plan.md` before implementation; consult `docs/decisions.md` for baseline clarifications.
- Follow `docs/DEVELOPMENT.md` for setup and verification. Update the implementation plan with evidence after each TASK.
- Source code belongs in root-level `miniprogram/` and `cloudfunctions/`; the original Chinese document-package directory only archives Word sources.
- Stage 1 means TASK-100 through TASK-103; TASK-001 through TASK-003 are its stage 0 prerequisites.

## Product boundary

- The app is a WeChat Mini Program for school audio and reviewed family letters.
- Only `admin` and `super_admin` may upload or publish audio.
- Normal users may submit text-and-image letters, but public display requires review.
- Do not add comments, private messages, payment, ads, user audio upload, followers, rankings, or a Web admin panel.

## Stack

- Native WeChat Mini Program with TypeScript strict mode.
- TDesign Miniprogram.
- CloudBase cloud functions, document database, storage, and security rules.
- Do not introduce FastAPI, PostgreSQL, Redis, Docker, Taro, or uni-app.

## Security

- Never trust client-supplied OpenID, role, schoolId, reviewStatus, or publish status.
- All privileged writes must go through cloud functions.
- Every admin action must verify role and school scope server-side.
- Administrator school authorization (`adminSchoolId`) is separate from user-selected `currentSchoolId`; choosing a class must never grant or change administrative scope.
- Establish deny-by-default database rules with TASK-102. Complete content safety and upload rules before the corresponding real business flows, even though TASK-600/601 appear in stage 6.
- Never commit secrets or real credentials.
- Use soft delete for business records.

## Code quality

- Avoid `any`; validate unknown external values before use.
- Pages call services; services call cloud functions.
- Use shared domain types, error codes, validation, and audit logging.
- Run lint, typecheck, and tests after each task.
- For documentation-only work before project scripts exist, validate links and diffs; report code checks as unavailable, never as passed.
- Preserve existing code unless replacement is necessary and documented.

## Delivery

- 用户要求无 AppID / 云环境也能操作已开发的业务：每个后续 TASK 同步提供显式标记、仅 dev 可启用、独立本地持久化的体验路径，复用正式页面与 service 契约。
- 本地体验数据与角色不得进入真实云环境；云请求失败不得自动转为本地成功。体验流程可用与真实平台验收分别记录。

- Work by TASK IDs in `docs/CODEX_TASKS.md`.
- For every task, list changed files, tests run, and known limitations.
- Do not claim completion when tests fail or when the flow is only mocked.
