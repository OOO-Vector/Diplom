import type { ReactNode } from "react";

export function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <h1>{title}</h1>
      {children}
    </section>
  );
}
