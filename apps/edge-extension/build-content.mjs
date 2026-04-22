import { build } from "esbuild";
import { resolve } from "path";

await build({
  entryPoints: [resolve("src/content/content-script.ts")],
  outfile: resolve("dist/content.js"),
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: true,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

console.log("content.js built");
