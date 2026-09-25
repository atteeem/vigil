import Link from "next/link";

/** A compact trail of related pages (not a full breadcrumb chain): e.g. "Live Map › Finland › Russia–Ukraine". Only
 * recorded relationships are passed in by the page; nothing is inferred here. */
export function ContextTrail({ items, className }: { items: { label: string; href: string }[]; className?: string }) {
  const shown = items.filter((i) => i.label && i.href).slice(0, 4);
  if (shown.length === 0) return null;
  return (
    <nav aria-label="Related context" className={className} data-testid="context-trail">
      <ol className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-ink-faint">
        {shown.map((i, n) => (
          <li key={`${i.href}-${n}`} className="flex items-center gap-1.5">
            {n > 0 && <span aria-hidden>›</span>}
            <Link href={i.href} className="hover:text-ink" data-testid="context-trail-link">
              {i.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
