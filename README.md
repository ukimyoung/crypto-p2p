# crypto-p2p

이용자끼리 암호화폐를 직접 거래하고, 거래 중인 코인은 플랫폼 에스크로로 보호하는 P2P 마켓플레이스입니다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `apps/api` | NestJS API. 원장, 광고, 주문(에스크로) 도메인 로직과 PostgreSQL 마이그레이션 |
| `apps/web` | Next.js 반응형 웹 |
| `docs/architecture.md` | 원장 모델과 주문 상태 설계 |
| `docs/api.md` | HTTP API 목록 |

## 데모 실행

[Docker Desktop](https://www.docker.com/products/docker-desktop/)만 있으면 DB, API, 웹이 한 번에 뜹니다. 체험용 계정, 잔고, 광고, 분쟁 중인 주문, 검토 대기 출금도 자동으로 들어갑니다.

```bash
git clone https://github.com/ukimyoung/crypto-p2p.git
cd crypto-p2p
docker compose up --build        # 처음엔 몇 분 걸립니다
```

브라우저에서 http://localhost:3001 (고객 화면)과 http://localhost:3001/ops (운영 콘솔)를 엽니다. 비밀번호는 모두 `demo password 1`입니다.

| 계정 | 용도 |
| --- | --- |
| `seller@demo.test` | 판매자 김판매. BTC·USDT 잔고, 판매 광고 2개, 검토 대기 출금 |
| `buyer@demo.test` | 구매자 이구매. BTC 잔고, 구매 광고 1개 |
| `reviewer1@demo.test`, `reviewer2@demo.test` | 운영자(심사). 분쟁은 한 명이 제안하고 다른 한 명이 승인합니다 |

로그인과 코인 전달에는 OTP 코드가 필요합니다. 인증 앱 없이 아래 명령으로 지금 코드를 볼 수 있습니다. 코드는 한 번만 쓸 수 있으니 같은 계정에 두 번째 코드가 필요하면 `next` 코드를 쓰거나 30초 기다리세요.

```bash
docker compose exec api node dist/demo/otp-cli.js
```

처음 상태로 되돌리려면 `docker compose down -v` 후 다시 `docker compose up`을 실행합니다. 데모 설정(공개된 암호화 키와 OTP 키, 대기 시간 0)은 체험용이므로 실제 서비스에 쓰지 마세요.

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

### 운영 콘솔

운영 콘솔은 같은 웹 앱의 `/ops`에 있습니다. 운영자 계정은 가입 화면 없이 CLI로만 만듭니다. 출력되는 OTP 키를 인증 앱에 등록해야 로그인할 수 있습니다.

```bash
OPERATOR_PASSWORD='...' DATABASE_URL=... OTP_ENCRYPTION_KEY=... \
  node apps/api/dist/ops/create-operator-cli.js kim@company.com 김운영 reviewer
```

권한은 `support`(조회만), `reviewer`(출금 승인·거절, 분쟁 제안·승인, 계정 제한), `admin`(현재 reviewer와 같음) 세 가지입니다. 운영 환경에서는 `/ops`를 사내망이나 VPN 뒤에만 열어 두세요.

API 테스트는 실제 PostgreSQL에 붙어서 돌고, 실행할 때마다 `public` 스키마를 지우고 다시 만듭니다. 운영 DB를 `DATABASE_URL`로 지정하지 마세요.

## 확인 명령

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
