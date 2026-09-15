# 实学夜话 Codex Rules

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
- Never commit secrets or real credentials.
- Use soft delete for business records.

## Code quality
- Avoid `any`; validate unknown external values before use.
- Pages call services; services call cloud functions.
- Use shared domain types, error codes, validation, and audit logging.
- Run lint, typecheck, and tests after each task.
- Preserve existing code unless replacement is necessary and documented.

## Delivery
- Work by TASK IDs in `docs/CODEX_TASKS.md`.
- For every task, list changed files, tests run, and known limitations.
- Do not claim completion when tests fail or when the flow is only mocked.
