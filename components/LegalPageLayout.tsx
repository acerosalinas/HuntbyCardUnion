export function LegalPageLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
      <p className="mt-1.5 text-xs font-medium uppercase tracking-wide text-foreground-muted">
        Last updated {updated}
      </p>
      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground-muted [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2 [&_ul]:space-y-1">
        {children}
      </div>
    </div>
  );
}
