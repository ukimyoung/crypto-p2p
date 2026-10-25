import { EmailMessage } from '../notifications/email.worker';

const TEXT = {
  ko: {
    subject: '[P2P] 이메일 인증을 완료해 주세요',
    intro: '가입을 마치려면 아래 링크를 눌러 이메일 주소를 인증해 주세요.',
    button: '이메일 인증하고 가입 완료',
    expiry: (h: number) => `링크는 ${h}시간 동안 유효합니다. 직접 가입하지 않았다면 이 메일은 무시하셔도 됩니다.`,
  },
  en: {
    subject: '[P2P] Confirm your email to finish signing up',
    intro: 'To finish signing up, open the link below to confirm your email address.',
    button: 'Confirm email and finish signup',
    expiry: (h: number) => `The link works for ${h} hours. If you did not sign up, you can ignore this email.`,
  },
};

/** The email with the link that completes a signup. */
export function signupEmail(to: string, locale: 'ko' | 'en', link: string, ttlHours: number): EmailMessage {
  const t = TEXT[locale];
  const href = escapeHtml(link);
  return {
    to,
    subject: t.subject,
    body: `${t.intro}\n\n${link}\n\n${t.expiry(ttlHours)}`,
    html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#111">
<p>${t.intro}</p>
<p><a href="${href}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none">${t.button}</a></p>
<p style="font-size:13px;color:#555">${t.expiry(ttlHours)}<br><a href="${href}" style="color:#555;word-break:break-all">${href}</a></p>
</div>`,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
