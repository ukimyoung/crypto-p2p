# 아키텍처 노트

## 원장

모든 잔고 변경은 `LedgerService.post`를 거칩니다. 다른 코드는 `ledger_accounts.balance`를 직접 바꾸지 않습니다.

- **금액 단위**: 코인은 자산의 최소 단위 정수(BTC는 satoshi, ETH는 wei)로, 법정화폐는 최소 단위 정수(KRW는 원, USD는 센트)로 저장합니다. 소수점 연산은 하지 않습니다.
- **계정**: 이용자마다 자산별로 `available`(가용), `escrow`(에스크로 잠금), `withdrawal_pending`(출금 대기) 계정이 있습니다. 시스템 계정은 `custody`(온체인 보관분의 상대 계정)와 `fee_revenue`(수수료 수익)입니다.
- **복식부기**: 한 거래의 분개 합은 자산별로 항상 0입니다. 서비스에서 먼저 검사하고, DB의 지연 제약 트리거가 커밋 시점에 다시 검사합니다.
- **음수 잔고 금지**: 이용자 계정은 CHECK 제약으로 0 미만이 될 수 없습니다. 잔고가 부족하면 `insufficient_balance` 오류가 나고 트랜잭션 전체가 롤백됩니다.
- **멱등성**: 모든 거래에 `idempotency_key`가 있어서 같은 키로 두 번 요청해도 한 번만 반영됩니다.
- **잠금 순서**: 계정은 id 순으로 잠가 동시 요청 사이의 교착을 막습니다. 주문 흐름에서는 주문, 광고, 원장 계정 순서로 잠급니다.
- **변경 불가 기록**: `ledger_entries`, `ledger_transactions`, `audit_logs`는 UPDATE와 DELETE를 트리거로 막습니다.
- **대사**: `findMismatchedAccounts`는 저장된 잔고와 분개 합이 다른 계정을 찾습니다. 일 대사 작업에서 결과가 비어 있어야 정상입니다.

## 주문 상태

PRD 6.4가 없어서 아래 상태는 PRD 5장의 흐름을 바탕으로 정했습니다. 허용 전이는 `apps/api/src/orders/order-state.ts`에 한곳에 모여 있습니다.

| 이벤트 | 누가 | 이전 상태 | 다음 상태 | 에스크로 |
| --- | --- | --- | --- | --- |
| 주문 생성 | 테이커 | - | `pending_payment` | 판매자 가용 → 에스크로 |
| `mark_paid` | 구매자 | `pending_payment` | `paid` | 변화 없음 |
| `release` | 판매자 | `pending_payment`, `paid` | `completed` | 에스크로 → 구매자 가용 (+ 수수료) |
| `cancel` | 구매자 | `pending_payment` | `cancelled` | 에스크로 → 판매자 가용 |
| `expire` | 시스템 | `pending_payment` (기한 초과) | `cancelled` | 에스크로 → 판매자 가용 |
| `escalate` | 구매자, 판매자 | `paid` | `under_review` | 변화 없음 |
| `resolve_release` | 운영자 2인 | `under_review` | `completed` | 에스크로 → 구매자 가용 |
| `resolve_refund` | 운영자 2인 | `under_review` | `cancelled` | 에스크로 → 판매자 가용 |

- 판매자는 구매자가 결제 완료를 누르기 전에도 입금을 확인했다면 릴리즈할 수 있습니다.
- 구매자는 결제 완료를 누른 뒤에는 취소할 수 없습니다. 이후 분쟁은 운영 검토로 갑니다.
- 정산 분개는 주문당 `order:{id}:settle` 키 하나를 씁니다. 릴리즈와 반환이 동시에 와도 한쪽만 반영됩니다.

## 수수료

광고주(메이커) 수수료는 거래 코인으로 받고, 요율은 `MAKER_FEE_BPS`(기본 0)로 정합니다.

- 판매 광고(메이커가 판매자): 판매자가 `수량 + 수수료`를 잠그고, 구매자는 `수량`을 받습니다.
- 구매 광고(메이커가 구매자): 판매자가 `수량`을 잠그고, 구매자는 `수량 - 수수료`를 받습니다.

## 결제수단

- 계좌 예금주는 KYC 실명(`users.legal_name`)과 같아야 등록됩니다. 공백, 대소문자, 전각 문자 차이는 같은 이름으로 봅니다. 제3자 계좌로 입금받는 것을 막기 위한 규칙입니다(PRD 11장).
- 계좌번호는 암호화해 저장하고, 목록에는 끝 4자리만 보여 줍니다. 전체 번호는 진행 중인 주문의 두 당사자에게만 보입니다.
- 새 계좌는 쿨다운(기본 24시간)이 지나야 쓸 수 있고, 등록·삭제에는 OTP가 필요합니다.
- 주문은 생성 시점의 판매자 계좌를 `seller_payment_method_id`로 고정합니다. 이후 계좌를 지워도 진행 중인 주문의 입금처는 바뀌지 않습니다.
- 1원 송금 같은 계좌 실소유 확인은 업체 연동 후 추가합니다.

## 출금

- 상태: `requested`(운영 검토 대기) → `approved`(커스터디로 넘길 준비) → `sent`(전송) → `confirmed`(완료). 검토 중 `rejected`·`cancelled`, 전송 실패 시 `failed`가 되며 이 세 경우 코인은 `available`로 돌아갑니다.
- 신청 시 `수량 + 수수료`를 `available`에서 `withdrawal_pending`으로 옮깁니다. 완료되면 수량은 `custody`로, 수수료는 `fee_revenue`로 갑니다(원장 키 `withdrawal:{id}:lock`, `withdrawal:{id}:settle`).
- 자동 승인 기준(`autoApproveMax`) 이하는 바로 `approved`, 넘으면 운영자 검토로 갑니다. 운영자 승인·거절과 커스터디 콜백(`markSent`, `markConfirmed`, `markFailed`)은 서비스에만 있고, 운영 도구와 커스터디 연동 때 HTTP로 엽니다.
- 한도는 KYC 단계별·코인별 24시간 누적(거절·취소·실패 건 제외)입니다. 같은 사용자의 신청은 사용자 행 잠금으로 직렬화해 동시 신청으로 한도를 넘을 수 없습니다.
- 출금은 화이트리스트에 등록하고 쿨다운이 지난 주소로만 갈 수 있습니다. 주소 등록·삭제와 출금 신청에 OTP가 필요합니다. `withdraw_held`나 `closed` 상태 계정은 출금할 수 없습니다.
- 수수료·최소 수량·한도 숫자는 `apps/api/src/wallet/wallet-config.ts`의 임시값입니다. 원화 환산 한도는 시세 피드가 붙은 뒤에 바꿉니다.
- 주소 검사는 형식만 봅니다(비트코인 bech32/base58, 이더리움 0x+40자리). 체크섬 검증은 커스터디 연동 때 서명 전에 한 번 더 합니다.

## 운영 콘솔

- 운영자는 `operators` 테이블에 따로 있고 세션(`operator_sessions`, 기본 8시간)과 로그인 기록도 이용자와 분리합니다. 이용자 토큰은 `/ops`에서, 운영자 토큰은 이용자 API에서 통하지 않습니다. 웹도 쿠키를 따로 씁니다(`p2p_ops_session`).
- 로그인할 때마다 OTP가 필요하고, 계정은 CLI로만 만듭니다.
- 분쟁 해결은 `dispute_resolutions`에 제안을 남기고, 다른 운영자가 승인하면 같은 트랜잭션에서 주문을 `completed`/`cancelled`로 바꾸고 에스크로를 옮깁니다. 같은 사람이 승인하는 것은 서비스와 DB 제약 양쪽에서 막습니다.
- 계정 제한: `trade_suspended`는 주문을, `withdraw_held`는 출금을, `closed`는 로그인을 막습니다. 진행 중인 주문과 출금은 그대로 둡니다.
- 운영자 동작마다 `audit_logs`에 `actor_type = 'operator'`로 남습니다.

## 아직 정하지 않은 것

- 판매 광고 등록 시 코인을 미리 잠글지(AD-5): 지금은 주문 생성 시점에 잠급니다.
- 변동가 광고(AD-3): 시세 피드가 붙으면 주문 시점 가격을 계산해 `price_minor`에 고정합니다.
- 결제 완료 후 판매자가 응답하지 않을 때 자동으로 운영 검토로 넘길 시간.
