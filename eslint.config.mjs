import base from "./lib/eslint-config/index.js";
export default [
  ...base,
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "packages/website/**",
      "worktrees/**",
    ],
  },
];
