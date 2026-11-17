import { LibraryPreview } from "@/components/library-preview";
import { MemoryDemo } from "@/components/memory-demo";
import { pageMetadata } from "@/lib/metadata";

const description =
  "Explore a sample notebook by date or connection, and see how Ask Grove answers from saved notes.";

export const metadata = pageMetadata(
  "Notebook examples",
  description,
  "/examples",
);

export default function ExamplesPage() {
  return (
    <main id="main" className="product-redesign notebook-home">
      <header className="page-container setup-page setup-intro">
        <h1 className="setup-heading">Notebook examples</h1>
        <p>{description}</p>
      </header>
      <LibraryPreview />
      <MemoryDemo />
    </main>
  );
}
