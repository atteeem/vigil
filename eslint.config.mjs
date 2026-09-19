import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  { ignores: [".next/**", ".next-test/**", ".claude/**", "node_modules/**", "public/**"] },
  ...nextCoreWebVitals,
];

export default eslintConfig;
