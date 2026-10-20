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
        applicationCategory: "ProductivityApplication",
        author: { "@type": "Organization", name: site.creator },
        operatingSystem: "Web",
        license: `${site.github}/blob/HEAD/LICENSE`,
        installUrl: `${site.url}/sign-up`,
        featureList: [
          "Private notes and notebooks",
          "Personal journal",
          "Search notes in your own words",
          "Ask Grove with links to source notes",
          "Connected ideas graph",
          "Earlier versions, archive and export",
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
