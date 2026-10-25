'use client';

import Link from 'next/link';
import { BankIcon, CheckIcon, KeyIcon, ScaleIcon, SearchIcon, ShieldIcon, WalletIcon } from '@/components/icons';
import { Market } from '@/components/Market';
import { useT } from '@/lib/i18n';
import { useMe } from '@/lib/use-me';

/** The landing page, for everyone: what the service is, the market, and how it works. */
export default function LandingPage() {
  const { me } = useMe();
  return (
    <>
      <Hero loggedIn={Boolean(me)} />
      <Market />
      <HowItWorks loggedIn={Boolean(me)} />
    </>
  );
}

function Hero({ loggedIn }: { loggedIn: boolean }) {
  const { t } = useT();
  return (
    <section className="hero">
      <div>
        <p className="eyebrow lined">Direct trade · Safe escrow</p>
        <h1>
          {t('사람과 직접 거래하고,')}
          <span className="accent">{t('코인은 에스크로가 지킵니다.')}</span>
        </h1>
        <p className="hero-lead">
          {t('원하는 가격의 광고를 고르고 원화 계좌이체로 결제하세요. 판매자가 입금을 확인하기 전까지 코인은 에스크로에 안전하게 잠겨 있습니다.')}
        </p>
        <div className="hero-cta">
          {loggedIn ? (
            <>
              <Link href="/market" className="button large">
                {t('마켓 둘러보기')}
              </Link>
              <Link href="/ads/new" className="button secondary large">
                {t('광고 등록')}
              </Link>
            </>
          ) : (
            <>
              <Link href="/signup" className="button large">
                {t('지금 시작하기')}
              </Link>
              <a href="#market" className="button secondary large">
                {t('마켓 둘러보기')}
              </a>
            </>
          )}
        </div>
        <ul className="feature-badges">
          <li>
            <ShieldIcon />
            {t('에스크로 보호')}
          </li>
          <li>
            <BankIcon />
            {t('원화 계좌이체')}
          </li>
          <li>
            <KeyIcon />
            {t('OTP 2단계 인증')}
          </li>
          <li>
            <ScaleIcon />
            {t('분쟁 시 운영팀 조정')}
          </li>
        </ul>
      </div>
      <div>
        <div className="hero-art">
          <HeroArt />
          <div className="hero-chip escrow float slow">
            <span className="chip-icon">
              <KeyIcon />
            </span>
            <span>
              {t('에스크로 잠금')}
              <small>{t('판매자 입금 확인 대기')}</small>
            </span>
          </div>
          <div className="hero-chip done float">
            <span className="chip-icon">
              <CheckIcon />
            </span>
            <span>
              {t('거래 완료')}
              <small>0.0100 BTC</small>
            </span>
          </div>
        </div>
        <p className="hero-caption">DIRECT · SAFE · PEER TO PEER</p>
      </div>
    </section>
  );
}

/** Two coins on an orbit: a coin and won changing hands. */
function HeroArt() {
  return (
    <svg viewBox="0 0 460 400" aria-hidden="true">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="coinA" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f6d27a" />
          <stop offset="100%" stopColor="#c9952a" />
        </linearGradient>
        <linearGradient id="coinB" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#13906b" />
          <stop offset="100%" stopColor="#064a37" />
        </linearGradient>
        <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#0b4a37" floodOpacity="0.25" />
        </filter>
      </defs>
      <ellipse cx="230" cy="200" rx="210" ry="170" fill="url(#glow)" />
      <ellipse className="orbit" cx="230" cy="200" rx="200" ry="118" transform="rotate(-20 230 200)" />
      <ellipse className="orbit dashed" cx="230" cy="200" rx="160" ry="150" transform="rotate(14 230 200)" />
      <circle cx="58" cy="262" r="5" fill="var(--accent)" opacity="0.5" />
      <circle cx="402" cy="128" r="4" fill="var(--gold)" opacity="0.7" />
      <circle cx="300" cy="60" r="3" fill="var(--accent)" opacity="0.4" />
      <g className="float">
        <circle cx="140" cy="132" r="62" fill="var(--surface)" filter="url(#shadow)" />
        <circle cx="140" cy="132" r="50" fill="url(#coinA)" />
        <circle cx="140" cy="132" r="42" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="2" />
        <text x="140" y="150" textAnchor="middle" fontSize="50" fontWeight="800" fill="#fff">
          ₿
        </text>
      </g>
      <g className="float slow">
        <circle cx="330" cy="272" r="60" fill="var(--surface)" filter="url(#shadow)" />
        <circle cx="330" cy="272" r="50" fill="url(#coinB)" />
        <circle cx="330" cy="272" r="42" fill="none" stroke="#fff" strokeOpacity="0.3" strokeWidth="2" />
        <text x="330" y="290" textAnchor="middle" fontSize="48" fontWeight="800" fill="#fff">
          ₩
        </text>
      </g>
      <g stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.75">
        <path d="M208 190h46l-12-12" />
        <path d="M252 214h-46l12 12" />
      </g>
    </svg>
  );
}

function HowItWorks({ loggedIn }: { loggedIn: boolean }) {
  const { t } = useT();
  return (
    <section className="section" id="how">
      <p className="eyebrow">How it works</p>
      <div className="section-head">
        <h2>{t('이용 방법')}</h2>
      </div>
      <div className="steps">
        <article className="card step">
          <div className="step-icon">
            <SearchIcon />
          </div>
          <h3>{t('광고 고르기')}</h3>
          <p>{t('코인과 가격, 거래 한도를 비교해 마음에 드는 광고를 고릅니다.')}</p>
        </article>
        <article className="card step">
          <div className="step-icon">
            <BankIcon />
          </div>
          <h3>{t('계좌이체로 결제')}</h3>
          <p>{t('주문하면 판매자의 코인이 에스크로에 잠깁니다. 안내된 계좌로 원화를 이체하세요.')}</p>
        </article>
        <article className="card step">
          <div className="step-icon">
            <WalletIcon />
          </div>
          <h3>{t('코인 받기')}</h3>
          <p>{t('판매자가 입금을 확인하면 에스크로의 코인이 내 지갑으로 들어옵니다.')}</p>
        </article>
      </div>
      {!loggedIn && (
        <div className="cta-band">
          <div>
            <h2>{t('지금 가입하고 첫 거래를 시작하세요')}</h2>
            <p>{t('가입 후 본인인증과 OTP 등록을 마치면 바로 거래할 수 있습니다.')}</p>
          </div>
          <div className="row">
            <Link href="/signup" className="button large">
              {t('가입하기')}
            </Link>
            <Link href="/login" className="button large ghost">
              {t('로그인')}
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

