import type { NextConfig } from "next";

// GitHub Pages serves the site under /<repo>, so CI sets DARKBENCH_BASE_PATH=/darkscan.
const basePath = process.env.DARKBENCH_BASE_PATH ?? "";

const config: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  transpilePackages: ["@darkscan/schema"],
};

export default config;
