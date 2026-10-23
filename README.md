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
| `reviewer1@demo.test`, `reviewer2@demo.test` | 운영자(심사). 분쟁 결정, 출금 승인, 한도 변경 때는 OTP 코드를 한 번 더 입력합니다 |

로그인과 코인 전달에는 OTP 코드가 필요합니다. 인증 앱 없이 아래 명령으로 지금 코드를 볼 수 있습니다. 코드는 한 번만 쓸 수 있으니 같은 계정에 두 번째 코드가 필요하면 `next` 코드를 쓰거나 30초 기다리세요.

```bash
docker compose exec api node dist/demo/otp-cli.js
```

처음 상태로 되돌리려면 `docker compose down -v` 후 다시 `docker compose up`을 실행합니다. 데모 설정(공개된 암호화 키와 OTP 키, 대기 시간 0)은 체험용이므로 실제 서비스에 쓰지 마세요.

### Docker 없이 인터넷에 띄우기 (Supabase + Render)

DB는 Supabase, 서버는 Render 무료 플랜에 올립니다. 저장소의 `render.yaml`이 API와 웹을 서비스 하나로 띄우고, 처음 뜰 때 위 데모 계정과 데이터를 넣습니다.

1. [Supabase](https://supabase.com)에서 새 프로젝트를 만듭니다. 리전은 Seoul(ap-northeast-2)이 가깝습니다. DB 비밀번호를 정해 둡니다.
2. 프로젝트 상단 **Connect** 버튼에서 **Session pooler** 주소를 복사하고, `[YOUR-PASSWORD]`를 1번에서 정한 비밀번호로 바꿉니다. Render는 IPv4만 쓰므로 Direct connection 주소는 쓸 수 없습니다.
3. [Render](https://render.com)에 GitHub 계정으로 가입하고 **New → Blueprint**에서 이 저장소를 고릅니다.
4. `DATABASE_URL`을 물으면 2번 주소를 붙여 넣고 **Apply**를 누릅니다. 첫 빌드는 5분 남짓 걸립니다.
5. 배포가 끝나면 `https://crypto-p2p-demo-xxxx.onrender.com` 같은 주소가 생깁니다. 운영 콘솔은 그 주소 뒤에 `/ops`입니다.

Render 무료 플랜에서는 명령을 실행할 수 없으므로, OTP 코드는 휴대폰 인증 앱(Google Authenticator 등)에 아래 키를 직접 입력해 받습니다. 키 출처는 `apps/api/src/demo/accounts.ts`입니다.

| 계정 | OTP 키 |
| --- | --- |
| `seller@demo.test` | `DEMOSELLERDEMOSELLERDEMOSELLER22` |
| `buyer@demo.test` | `DEMOBUYERDEMOBUYERDEMOBUYERDEMO2` |
| `reviewer1@demo.test` | `DEMOREVIEWERONEDEMOREVIEWERONE22` |
| `reviewer2@demo.test` | `DEMOREVIEWERTWODEMOREVIEWERTWO22` |

무료 플랜은 15분 동안 접속이 없으면 잠들고, 다음 접속 때 30초쯤 걸려 깨어납니다. 주소를 아는 사람은 누구나 공개된 데모 계정으로 들어올 수 있으니 실제 고객 정보나 돈은 넣지 마세요.

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

권한은 `reviewer`(조회, 출금 승인·거절, 분쟁 결정, 계정 제한, 출금 한도 변경)와 `admin`(reviewer 권한에 더해 시스템 관리) 두 가지입니다. 코인이 움직이거나 한도가 바뀌는 동작은 새 OTP 코드로 5분 동안 열리는 재확인(step-up)이 필요합니다. 운영 환경에서는 `/ops`를 사내망이나 VPN 뒤에만 열어 두세요.

API 테스트는 실제 PostgreSQL에 붙어서 돌고, 실행할 때마다 `public` 스키마를 지우고 다시 만듭니다. 운영 DB를 `DATABASE_URL`로 지정하지 마세요.

## 확인 명령

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
