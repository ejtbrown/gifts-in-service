import "dotenv/config";
import { loadConfig } from "@gis/shared";
import { buildApp } from "./app.js";

const config = loadConfig();
const app = await buildApp({ config });
await app.listen({ port: config.PORT, host: "127.0.0.1" });
process.stdout.write(
  `Gifts in Service API listening on http://127.0.0.1:${config.PORT}\n`,
);
