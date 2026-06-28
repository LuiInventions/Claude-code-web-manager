import "./lib/load-env";
import { startServer } from "./lib/server/start";

startServer().catch((err) => {
  console.error("[control-center] failed to start:", err);
  process.exit(1);
});
