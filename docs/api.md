# HTTP API

모든 응답은 JSON입니다. 코인·법정화폐 금액은 최소 단위 정수를 **문자열**로 주고받습니다(예: 0.01 BTC = `"1000000"`).
오류는 `{ "error": { "code": "...", "message": "..." } }` 형식입니다.

인증이 필요한 요청은 `Authorization: Bearer <token>` 헤더를 붙입니다.

## 인증 (AUTH-1, AUTH-3)

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| POST | `/auth/signup` | - | `{ email, password }`. 비밀번호는 10~128자, 영문과 숫자 포함 |
| POST | `/auth/login` | - | `{ email, password, otp? }` → `{ token }`. OTP를 켠 계정은 `otp` 필수. 15분에 5회 실패하면 잠김 |
| POST | `/auth/logout` | O | 현재 세션 만료 |
| GET | `/me` | O | 내 정보 (`kycLevel`, `otpEnabled` 등) |
| POST | `/auth/otp/setup` | O | `{ secret, otpauthUrl }`. 인증 앱에 등록 |
| POST | `/auth/otp/enable` | O | `{ code }`. 앱에 뜬 6자리 코드로 OTP 활성화 |

OTP 코드는 한 번만 쓸 수 있습니다. 같은 30초 구간의 코드를 다시 보내면 거절됩니다.

## 광고 (AD-1, AD-2)

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| GET | `/ads?asset=BTC&fiat=KRW&side=sell` | - | 마켓 목록. `side`는 광고주 기준(구매자는 `sell` 광고를 봄). 좋은 가격 순 |
| POST | `/ads` | O + OTP 활성 | `{ side, asset, fiat, priceMinor, totalAmount, minOrderFiatMinor, maxOrderFiatMinor, paymentWindowMinutes?, minTakerKycLevel? }` |

## 주문

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| GET | `/orders` | O | 내 주문 목록 (최신순) |
| POST | `/orders` | O + OTP 활성 | `{ adId, amount }`. 판매자 코인이 에스크로에 잠김 |
| GET | `/orders/:id` | O | 거래 당사자만 조회 가능 (그 외 404) |
| POST | `/orders/:id/paid` | 구매자 | 이체 완료 표시 |
| POST | `/orders/:id/release` | 판매자 | `{ otp }`. 수령 확인 후 코인 전달. OTP 코드 필수 |
| POST | `/orders/:id/cancel` | 구매자 | 결제 표시 전에만 취소 가능 |
| POST | `/orders/:id/escalate` | 당사자 | 결제 표시 후 운영 검토 요청 |
