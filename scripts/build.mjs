import { build } from "tsup";
for (const name of ["core", "dictionary", "client", "server", "cli"]) {
  const entry =
    name === "cli"
      ? ["packages/cli/src/main.ts"]
      : name === "server"
        ? ["packages/server/src/app.ts", "packages/server/src/main.ts"]
        : ["packages/" + name + "/src/index.ts"];
  await build({
    entry,
    outDir: `packages/${name}/dist`,
    format: ["esm"],
    target: "node22",
    platform: "node",
    bundle: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: name !== "cli",
    external: [
      "fastify",
      "@fastify/cors",
      "@fastify/rate-limit",
      "@fastify/swagger",
      "@fastify/swagger-ui",
      "pg",
      "saxes",
      "wanakana",
    ],
    silent: true,
  });
  console.log(`Built @yomichi/${name}`);
}
