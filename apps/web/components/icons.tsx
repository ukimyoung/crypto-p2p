import type { ReactNode } from 'react';

/** Small line icons drawn with the current text colour. */
type Props = { size?: number };

function Icon({ size = 16, children }: Props & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ShieldIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
);

export const BankIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M3 10l9-6 9 6" />
    <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18" />
  </Icon>
);

export const KeyIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 018 0v3M12 14v3" />
  </Icon>
);

export const ScaleIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 006 0L5 8zM19 8l-3 6a3 3 0 006 0l-3-6z" />
  </Icon>
);

export const SearchIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
);

export const SwapIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M4 8h14l-4-4M20 16H6l4 4" />
  </Icon>
);

export const CheckIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12l3 3 5-6" />
  </Icon>
);

export const LockIcon = KeyIcon;

export const InfoIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);

export const ResetIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M4 12a8 8 0 108-8H8M8 4l-3 3 3 3" />
  </Icon>
);

export const WalletIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="3" y="6" width="18" height="14" rx="2" />
    <path d="M3 10h18M16 15h2" />
  </Icon>
);
