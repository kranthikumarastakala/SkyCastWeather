import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isUserOrOrgSite = repoName?.toLowerCase().endsWith(".github.io");
const customDomain = (
  process.env.GITHUB_PAGES_CUSTOM_DOMAIN ?? process.env.CUSTOM_DOMAIN ?? ""
).trim();
const shouldUseRootBase = isUserOrOrgSite || Boolean(customDomain);

export default defineConfig({
  plugins: [react()],
  base:
    process.env.GITHUB_ACTIONS && repoName
      ? shouldUseRootBase
        ? "/"
        : `/${repoName}/`
      : "/",
});
