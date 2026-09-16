import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "public/**"] },
  ...nextCoreWebVitals,
];

export default eslintConfig;
