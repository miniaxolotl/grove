import { ArrowUpRight } from "lucide-react";

const products = [
  {
    id: "fern",
    name: "Fern",
    detail: "Shared moments",
    url: "https://usefern.app",
  },
  {
    id: "burrow",
    name: "Burrow",
    detail: "Localhost, shared",
    url: "https://useburrow.app",
  },
  {
    id: "grove",
    name: "Grove",
    detail: "Memory for agents",
    url: "https://usegrove.cloud",
  },
];

export function BrambleFamily({ current }: { current: string }) {
  return (
    <div className="bramble-family">
      <a className="bramble-family-company" href="https://bramblelabs.co">
        <svg
          width="30"
          height="30"
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M24 43V18M24 34 12 22M24 25 36 13"
            stroke="currentColor"
            strokeWidth="2.7"
            strokeLinecap="round"
          />
          <path
            d="M24 20C12 18 11 9 15 3c10 2 15 8 9 17ZM23 34C10 35 4 28 5 20c11-2 19 3 18 14ZM26 25c-1-12 5-19 16-18 0 11-5 18-16 18Z"
            fill="currentColor"
          />
        </svg>
        <span>
          <strong>From Bramble Labs</strong>
          <small>Good ideas. Carefully grown.</small>
        </span>
        <ArrowUpRight size={14} aria-hidden="true" />
      </a>
      <nav aria-label="Bramble Labs products">
        {products.map((product) =>
          product.id === current ? (
            <span key={product.id} aria-current="page">
              <strong>{product.name}</strong>
              <small>{product.detail}</small>
            </span>
          ) : (
            <a key={product.id} href={product.url}>
              <strong>
                {product.name}
                <ArrowUpRight size={11} aria-hidden="true" />
              </strong>
              <small>{product.detail}</small>
            </a>
          ),
        )}
      </nav>
    </div>
  );
}
