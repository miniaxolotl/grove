import base from "@lib/eslint-config";
import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...base,
  ...nextVitals,
  {
    ignores: [
      ".next/**",
      "next-env.d.ts",
      "test-results/**",
      "playwright-report/**",
    ],
  },
];

export default config;
