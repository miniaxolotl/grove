import { faqs } from "@/content/site";
import { site } from "@/lib/site";

export function StructuredData() {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${site.url}/#website`,
        name: site.name,
        url: site.url,
        description: site.description,
        inLanguage: "en",
        publisher: { "@type": "Organization", name: site.creator },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${site.url}/#software`,
        name: site.name,
        url: site.url,
        description: site.description,
        applicationCategory: "DeveloperApplication",
        author: { "@type": "Organization", name: site.creator },
        operatingSystem: "Linux, macOS, Windows",
        license: `${site.github}/blob/HEAD/LICENSE`,
        downloadUrl: site.npm,
        installUrl: `${site.url}/install`,
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: [
          "Persistent semantic memory",
          "Private personal and project memories",
          "PostgreSQL and pgvector storage",
          "Local ONNX embeddings",
          "MCP over HTTP and stdio",
          "Revision history, archive and deletion",
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map(({ question, answer }) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
