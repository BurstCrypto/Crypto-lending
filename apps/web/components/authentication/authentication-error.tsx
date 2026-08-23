'use client';

import { useEffect, useRef } from 'react';

interface AuthenticationErrorProps {
  readonly active: boolean;
  readonly children: string;
  readonly id?: string;
}

export function AuthenticationError({ active, children, id }: AuthenticationErrorProps) {
  const errorReference = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) errorReference.current?.focus();
  }, [active]);

  if (!active) return null;

  return (
    <div ref={errorReference} className="authentication-error" id={id} role="alert" tabIndex={-1}>
      <span className="authentication-error-mark" aria-hidden="true">
        !
      </span>
      <div>
        <p className="authentication-error-title">We couldn&apos;t complete that securely.</p>
        <p>{children}</p>
      </div>
    </div>
  );
}
