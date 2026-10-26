import { notFound } from "next/navigation";
import { documentation } from "@/content/documentation";
import {
  DocumentationPage,
  DocumentationMarkdown,
} from "@/components/documentation-page";
import { loadDocumentation } from "@/lib/documentation";
import { pageMetadata } from "@/lib/metadata";

export const dynamicParams = false;
export function generateStaticParams() {
  return documentation.map(({ slug }) => ({ slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const document = documentation.find((item) => item.slug === slug);
  if (!document) notFound();
  return pageMetadata(
    document.title,
    document.description,
    `/docs/${document.slug}`,
  );
}
export default async function ReferencePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const document = await loadDocumentation((await params).slug);
  if (!document) notFound();
  return (
    <DocumentationPage
      title={document.title}
      description={document.description}
      slug={document.slug}
    >
      <DocumentationMarkdown
        markdown={document.markdown}
        source={document.source}
      />
    </DocumentationPage>
  );
}
