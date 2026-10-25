# HTTP API

모든 응답은 JSON입니다. 코인·법정화폐 금액은 최소 단위 정수를 **문자열**로 주고받습니다(예: 0.01 BTC = `"1000000"`).
오류는 `{ "error": { "code": "...", "message": "..." } }` 형식입니다.

인증이 필요한 요청은 `Authorization: Bearer <token>` 헤더를 붙입니다.

## 인증 (AUTH-1, AUTH-3)

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| POST | `/auth/signup` | - | `{ email, password, phoneCountry, phoneNumber, nickname, locale? }` → 202 `{ email }`. 계정은 아직 만들지 않고 이메일로 인증 링크(`<APP_URL>/signup/verify?token=…`, 24시간 유효)를 보냄. 같은 이메일로 다시 보내면 입력값을 고치고 새 링크를 보내 이전 링크는 무효가 됨. 단 1분 안에 다시 보내면(두 번 클릭 등) 새 메일 없이 이미 보낸 링크를 그대로 두고 똑같이 202. 메일 발송 실패는 503 `email_unavailable`. 닉네임은 2~16자 한글·영문·숫자·밑줄이고 대소문자 구분 없이 중복 불가(409 `nickname_taken`, 형식 오류 400 `invalid_nickname`). 비밀번호는 10~128자, 영문과 숫자 포함. 특수문자(`! @ #` 등)·공백 등 다른 문자도 사용 가능. `phoneCountry`는 ISO 국가 코드(`KR`), `phoneNumber`는 그 나라 방식 번호(`010-1234-5678`)이고 +8210… 형식으로 저장. 번호 중복은 409 `phone_taken`, 형식 오류는 400 `invalid_phone` |
| POST | `/auth/signup/resend` | - | `{ email }`. 인증 전인 가입 신청에 새 링크를 보냄. 신청이 없거나 1분이 안 지났어도 똑같이 204 |
| POST | `/auth/signup/verify` | - | `{ token }` → `{ user, token }`. 메일의 링크로 가입을 마치고 바로 로그인한 세션 토큰을 돌려줌. 링크는 한 번만 쓸 수 있음. 잘못되었거나 이미 쓴 링크는 400 `invalid_signup_link`, 기한이 지나면 410 `signup_link_expired`, 기다리는 사이 다른 회원이 닉네임·번호를 가져갔으면 409 `nickname_taken`/`phone_taken`(신청은 지워지므로 다시 가입) |
| POST | `/auth/login` | - | `{ email, password, otp? }` → `{ token }`. OTP를 켠 계정은 `otp` 필수. 15분에 5회 실패하면 잠김 |
| POST | `/auth/logout` | O | 현재 세션 만료 |
| GET | `/me` | O | 내 정보 (`nickname`, `kycLevel`, `otpEnabled`, `locale` 등) |
| POST | `/me/nickname` | O | `{ nickname }`. 닉네임 변경. 바뀐 회원 정보를 돌려줌 |
| POST | `/me/phone` | O | `{ phoneCountry, phoneNumber, otp? }`. 휴대폰 번호 등록·변경. OTP를 켠 회원은 `otp` 필요. 바뀐 회원 정보를 돌려줌 |
| POST | `/me/locale` | O | `{ locale: 'ko' \| 'en' }`. 화면과 이메일 언어. 204 |
| POST | `/auth/otp/setup` | O | `{ secret, otpauthUrl }`. 인증 앱에 등록 |
| POST | `/auth/otp/enable` | O | `{ code }`. 앱에 뜬 6자리 코드로 OTP 활성화 |

OTP 코드는 한 번만 쓸 수 있습니다. 같은 30초 구간의 코드를 다시 보내면 거절됩니다.

## 본인 인증 (KYC-1, KYC-2)

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| GET | `/kyc` | O | `{ kycLevel, available, applicant }`. `applicant`는 심사 상태, 결과(`GREEN`/`RED`), 거절 종류(`RETRY`/`FINAL`), 회원 안내 문구 |
| POST | `/kyc/token` | O | `{ token, levelName }`. Sumsub WebSDK 토큰. 이미 인증했으면 409, 최종 거절이면 `kyc_rejected`(403) |
| POST | `/kyc/sumsub/webhook` | 서명 | Sumsub 웹훅. `X-Payload-Digest`(HMAC) 검증, 틀리면 401. 같은 본문은 한 번만 반영 |

Sumsub 키가 없으면 `kyc_unavailable`(503), Sumsub API 오류는 `kyc_provider_error`(502)입니다.

## 광고 (AD-1, AD-2)

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| GET | `/ads?asset=BTC&fiat=KRW&side=sell` | - | 마켓 목록. `side`는 광고주 기준(구매자는 `sell` 광고를 봄). 좋은 가격 순. 각 광고에 `feeRateBp`와 수수료를 더한 `finalPriceMinor`. 연체 광고주의 광고는 빠짐 |
| GET | `/ads/fee-rate?asset=BTC&fiat=KRW` | - | 마켓의 지금 광고 수수료율 `{ feeRateBp }` (0.01% 단위). 광고 등록 화면의 가격 미리보기용 |
| POST | `/ads` | O + OTP 활성 | `{ side, asset, fiat, priceMinor, totalAmount, minOrderFiatMinor, maxOrderFiatMinor, paymentWindowMinutes?, minTakerKycLevel?, paymentMethodId? }`. 판매 광고는 입금받을 `paymentMethodId` 필수 |

## 결제수단 (PAY-1)

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| GET | `/payment-methods` | O | 내 계좌 목록 (최대 1개, 계좌번호는 끝 4자리만) |
| POST | `/payment-methods` | O | `{ fiat, bankCode, accountHolder, accountNumber, otp }`. 예금주가 KYC 실명과 같아야 함. OTP 필수. 회원당 1개만 등록 가능 (이미 있으면 409 `payment_method_exists`) |
| PUT | `/payment-methods/:id` | O | `{ bankCode, accountHolder, accountNumber, otp }`. 등록된 계좌의 은행·계좌번호 변경. 새 `id`로 바뀌고, 진행 중인 내 광고는 새 계좌로 옮겨짐. 이미 열린 주문은 원래 계좌 유지. 쿨다운을 새로 시작하지 않음 |
| DELETE | `/payment-methods/:id` | O | `{ otp }` |

새 계좌는 처음 등록한 뒤 `PAYMENT_METHOD_COOLDOWN_HOURS`(기본 24시간)가 지나야 광고·주문에 쓸 수 있습니다. 등록된 계좌를 변경하면 기존 계좌의 쿨다운을 이어받으므로 바로 쓸 수 있습니다.

## 주문

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| GET | `/orders` | O | 내 주문 목록 (최신순) |
| POST | `/orders` | O + OTP 활성 | `{ adId, amount, paymentMethodId? }`. 판매자 코인이 에스크로에 잠김. 구매 광고에 파는 경우 입금받을 `paymentMethodId` 필수 |
| GET | `/orders/:id` | O | 거래 당사자만 조회 가능 (그 외 404). 주문이 진행 중이면 `paymentDetails`에 판매자 계좌 전체 정보 |
| POST | `/orders/:id/paid` | 구매자 | 이체 완료 표시 |
| POST | `/orders/:id/release` | 판매자 | `{ otp }`. 수령 확인 후 코인 전달. OTP 코드 필수 |
| POST | `/orders/:id/cancel` | 구매자 | 결제 표시 전에만 취소 가능 |
| POST | `/orders/:id/escalate` | 당사자 | 결제 표시 후 운영 검토 요청 |
| GET | `/orders/:id/messages?after=` | 당사자 | 주문 채팅. `after`보다 뒤의 메시지만 (폴링용) |
| POST | `/orders/:id/messages` | 당사자 | `{ body }`. 1~1000자. 지울 수 없음(분쟁 증빙) |

결제 기한이 지난 미결제 주문은 서버가 `ORDER_EXPIRY_INTERVAL_SECONDS`(기본 30초)마다 자동 취소하고 코인을 판매자에게 돌려줍니다.

## 지갑 (WAL-2, WAL-3)

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| GET | `/wallet/balances` | O | 코인별 `available`, `escrow`, `withdrawalPending` |
| GET | `/wallet/addresses` | O | 출금 주소 화이트리스트 |
| POST | `/wallet/addresses` | O | `{ asset, address, label?, otp }`. 네트워크에 맞는 주소 형식만 받음. OTP 필수 |
| DELETE | `/wallet/addresses/:id` | O | `{ otp }` |
| GET | `/wallet/withdrawals` | O | 내 출금 내역(최신순)과 코인별 수수료·최소 수량·24시간 한도·사용량 |
| POST | `/wallet/withdrawals` | O | `{ addressId, amount, otp }`. `amount`는 받을 수량이고 수수료는 별도로 빠짐 |
| POST | `/wallet/withdrawals/:id/cancel` | 본인 | 운영 검토 대기(`requested`) 중에만 취소 가능 |

새 주소는 등록 후 `ADDRESS_COOLDOWN_HOURS`(기본 24시간)가 지나야 출금에 쓸 수 있습니다.

## 광고 수수료 청구 (FEE-6)

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| GET | `/fees/invoices` | O | 내 청구서(최근 100건)와 아직 청구되지 않은 수수료 합계 |

## 알림 (NOTI-1)

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| GET | `/notifications` | O | 최근 50건(최신순)과 안 읽은 수. `type`과 `data`만 주고 문구는 웹이 이용자 언어로 만듦 |
| GET | `/notifications/unread-count` | O | `{ unread }` |
| POST | `/notifications/read` | O | `{ upToId }`. 그 id까지 읽음 처리 |

알림 종류: `order.created`, `order.paid`, `order.completed`, `order.cancelled`, `order.under_review`, `order.message`, `withdrawal.approved`, `withdrawal.rejected`, `withdrawal.sent`, `withdrawal.confirmed`, `withdrawal.failed`, `account.status_changed`.

## 운영 콘솔 (`/ops`)

이용자 토큰으로는 호출할 수 없고, 운영자 로그인으로 받은 토큰만 받습니다. 운영자의 모든 동작은 감사 로그에 남습니다.

| 메서드 | 경로 | 권한 | 설명 |
| --- | --- | --- | --- |
| POST | `/ops/auth/login` | - | `{ email, password, otp }`. OTP 항상 필수. 5회 실패 시 15분 잠금 |
| POST | `/ops/auth/logout` | 모두 | |
| POST | `/ops/auth/step-up` | 모두 | `{ otp }`. 새 OTP 코드로 이 세션의 민감 동작을 5분 동안 허용. 로그인에 쓴 코드는 다시 못 씀 |
| GET | `/ops/me` | 모두 | 로그인한 운영자와 `stepUpUntil` |
| GET | `/ops/summary` | 모두 | 검토 대기 출금 수, 진행 중 분쟁 수, 그중 자동 전환 수 |
| GET | `/ops/withdrawals?status=` | 모두 | 상태별 출금(기본 `requested`), 오래된 순 |
| POST | `/ops/withdrawals/:id/approve` | reviewer | OTP 재확인(step-up) 필요 |
| POST | `/ops/withdrawals/:id/reject` | reviewer | `{ note }`. 사유는 이용자에게 보임 |
| GET | `/ops/disputes` | 모두 | 운영 검토 중인 주문 |
| GET | `/ops/disputes/:orderId` | 모두 | 주문, 당사자, 채팅 전체, 결정 이력 |
| POST | `/ops/disputes/:orderId/resolve` | reviewer | `{ decision: release \| refund, reason }`. 결정과 동시에 코인 이동. step-up 필요 |
| GET | `/ops/users?q=&status=&kycLevel=&from=&to=&sort=&dir=&page=&pageSize=` | 모두 | 회원 그리드. 기본은 전체 회원 가입일 최신순, 페이지당 20·50·100(기본 50). `q`는 이메일 일부, 전화, 실명, 회원 ID. 전화·실명은 가림 |
| GET | `/ops/users/:id` | 모두 | 회원 정보(가림), 잔고, 주문, 출금, 계좌(가림), 출금 주소, 광고, 로그인 기록, 처리 이력 |
| POST | `/ops/users/:id/reveal` | reviewer | `{ reason }`. 전체 이메일·전화·실명. step-up 필요. 열람 자체가 감사 로그에 남음 |
| POST | `/ops/users/:id/kyc-level` | reviewer | `{ level, reason }`. 예외용 KYC 등급 수동 조정. `level`은 0 또는 1 |
| GET | `/ops/users/:id/kyc` | 모두 | KYC 탭. Sumsub 상태, 결과, 거절 사유, 내부 메모, 마지막 갱신, 콘솔 링크(`consoleUrl`), 최근 웹훅 |
| POST | `/ops/users/:id/kyc/sync` | reviewer | Sumsub에서 지원자를 다시 읽어 반영(웹훅 누락 대비) |
| POST | `/ops/users/:id/kyc/request-check` | reviewer | `{ reason }`. Sumsub에 재심사 요청 |
| GET | `/ops/settings/kyc` | 모두 | Sumsub 연결 여부, 레벨 이름, 마지막 웹훅 수신 시각, 최근 24시간 웹훅 수. 키는 보여 주지 않음 |
| GET | `/ops/ads?asset=&fiat=&side=&status=&makerId=&sort=&dir=&page=&pageSize=` | 모두 | 광고 그리드. 정렬은 `created_at`, `price_minor`, `remaining_amount` |
| GET | `/ops/ads/:id` | 모두 | 광고, 지금 요율의 최종 가격, 이 광고로 생긴 주문 |
| POST | `/ops/ads/:id/status` | reviewer | `{ status: offline \| closed, reason }`. 진행 중 주문은 유지. 광고주에게 알림(사유는 안 보냄) |
| GET | `/ops/orders?status=&asset=&userId=&from=&to=&page=&pageSize=` | 모두 | 전체 주문, 최신순 |
| GET | `/ops/orders/:id` | 모두 | 주문, 상태 이력, 채팅, 원장 분개 |
| GET | `/ops/markets` | 모두 | 코인 상태와 마켓(코인 × 법정화폐) 상태, 노출 광고·진행 중 주문 수 |
| PUT | `/ops/markets/:asset/:fiat` | admin | `{ status: open \| paused \| closed, reason }`. 멈추면 새 광고·주문을 막고 마켓 목록에서 숨김 |
| PUT | `/ops/markets/assets/:code` | admin | `{ status: active \| ads_paused \| withdrawals_paused \| delisted, reason }` |
| POST | `/ops/users/:id/status` | reviewer | `{ status, reason }`. `closed`는 모든 세션을 끊고 step-up 필요 |
| GET | `/ops/settings/withdrawal-rules` | 모두 | 코인별 출금 수수료, 최소 수량, 자동 승인 기준, KYC 단계별 24시간 한도 |
| PUT | `/ops/settings/withdrawal-rules/:asset` | reviewer | `{ fee, minAmount, autoApproveMax, dailyLimits: { "1": "..." }, reason }`. 최소 단위 정수 문자열. 키는 KYC 0 또는 1, 빠진 단계는 출금 불가. step-up 필요 |
| GET | `/ops/settings/fee-rates` | 모두 | 기본 요율, 마켓별 지금 요율, 예약된 변경, 변경 이력 |
| POST | `/ops/settings/fee-rates` | reviewer | `{ asset?, fiat?, rateBp, effectiveFrom?, reason }`. 둘 다 빼면 기본 요율. 마켓에 `rateBp: null`이면 기본 요율로 되돌림. step-up 필요 |
| GET | `/ops/settings/orders` | 모두 | `{ autoReviewMinutes }` |
| PUT | `/ops/settings/orders` | reviewer | `{ autoReviewMinutes: 1~1440, reason }`. 결제 완료 후 이 시간 동안 릴리즈가 없으면 자동 운영 검토. step-up 필요 |
| GET | `/ops/settings/billing` | 모두 | `{ cycle: daily \| monthly, dueDays }` |
| PUT | `/ops/settings/billing` | reviewer | `{ cycle, dueDays, reason }`. step-up 필요 |
| GET | `/ops/fees/summary?from=&to=` | 모두 | 기간(기본 이번 달) 확정·청구 전·납부 합계, 전체 미납·연체, 미납 광고주, 코인별 출금 수수료 누적 |
| GET | `/ops/fee-invoices?status=&makerId=&page=` | 모두 | 청구서 목록, 20건씩 |
| GET | `/ops/fee-invoices/:id` | 모두 | 청구서, 포함된 주문, 납부 내역 |
| POST | `/ops/fee-invoices/:id/payments` | reviewer | `{ amountMinor, paidAt, memo }`. 시스템 밖 입금을 기록. step-up 필요 |
| POST | `/ops/fees/run-billing` | admin | 청구 작업을 바로 실행 |
| GET | `/ops/audit?targetId=&actorId=` | 모두 | 최근 100건. `targetId`는 회원·주문 ID나 코인 코드 |

