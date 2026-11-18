import Link from "next/link";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { documentationHref } from "@/content/documentation";
import styles from "./documentation-page.module.css";

export function DocumentationPage({
  title,
  sections,
  children,
}: {
  title: string;
  sections: readonly (readonly [string, string])[];
  children: ReactNode;
}) {
  const links = (
    <>
      {sections.map(([label, id]) => (
        <a key={id} href={`#${id}`}>
          {label}
        </a>
      ))}
    </>
  );
  return (
    <main id="main" className={`page-container ${styles.page}`}>
      <Link href="/docs" className={styles.back}>
        ← All documentation
      </Link>
      <header className={styles.heading}>
        <h1>{title}</h1>
      </header>
      <div className={styles.layout}>
        <div className={styles.sidebar}>
          <details className={styles.mobileNavigation}>
            <summary>In this guide</summary>
            <nav className={styles.navigation} aria-label="In this guide">
              {links}
            </nav>
          </details>
          <nav
            className={`${styles.navigation} ${styles.desktopNavigation}`}
            aria-label="In this guide"
          >
            <strong>In this guide</strong>
            {links}
          </nav>
        </div>
        <article className={styles.body}>{children}</article>
      </div>
    </main>
  );
}

export function DocumentationMarkdown({
  markdown,
  source,
}: {
  markdown: string;
  source: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSlug]}
      skipHtml
      components={{
        a: ({ href, children }) => (
          <a href={href ? documentationHref(href, source) : undefined}>
            {children}
          </a>
        ),
        pre: ({ children }) => (
          <pre tabIndex={0} aria-label="Code example">
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div
            className={styles.table}
            role="region"
            aria-label="Reference table"
            tabIndex={0}
          >
            <table>{children}</table>
          </div>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
