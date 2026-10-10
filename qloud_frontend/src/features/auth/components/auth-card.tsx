import type * as React from 'react';

interface AuthCardProps {
  title: string;
  description?: string;
  footer?: React.ReactNode;
}

/** The centred card every auth screen (S-01 to S-04) is laid out in. */
export function AuthCard({
  title,
  description,
  footer,
  children,
}: React.PropsWithChildren<AuthCardProps>): React.JSX.Element {
  return (
    <section className="mx-auto w-full max-w-sm">
      <div className="rounded-lg border border-border bg-card p-6 shadow-soft sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        )}
        <div className="mt-6">{children}</div>
      </div>
      {footer && (
        <div className="mt-4 text-center text-sm text-muted-foreground">
          {footer}
        </div>
      )}
    </section>
  );
}
