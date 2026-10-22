# crypto-p2p

이용자끼리 암호화폐를 직접 거래하고, 거래 중인 코인은 플랫폼 에스크로로 보호하는 P2P 마켓플레이스입니다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `apps/api` | NestJS API. 원장, 광고, 주문(에스크로) 도메인 로직과 PostgreSQL 마이그레이션 |
| `apps/web` | Next.js 반응형 웹 |
| `docs/architecture.md` | 원장 모델과 주문 상태 설계 |
| `docs/api.md` | HTTP API 목록 |

## 개발 환경

필요한 것: Node.js 22 이상, pnpm 10, PostgreSQL 16.

```bash
pnpm install

# 테스트용 DB를 만들고 전체 테스트 실행
createdb p2p_test
DATABASE_URL=postgres://postgres@localhost:5432/p2p_test pnpm test

# API 실행
cp apps/api/.env.example apps/api/.env   # 값 수정 (OTP_ENCRYPTION_KEY는 openssl rand -base64 32)
pnpm --filter @crypto-p2p/api build
DATABASE_URL=... pnpm --filter @crypto-p2p/api migrate
DATABASE_URL=... pnpm --filter @crypto-p2p/api start   # GET /health

# 웹 실행 (http://localhost:3001, API는 API_URL로 지정)
API_URL=http://localhost:3000 pnpm --filter @crypto-p2p/web dev
```

웹은 `/api/*` 요청을 API 서버로 넘기는 프록시를 두고, 로그인 토큰은 브라우저 스크립트가 읽을 수 없는 httpOnly 쿠키에 보관합니다.

API 테스트는 실제 PostgreSQL에 붙어서 돌고, 실행할 때마다 `public` 스키마를 지우고 다시 만듭니다. 운영 DB를 `DATABASE_URL`로 지정하지 마세요.

## 확인 명령

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
