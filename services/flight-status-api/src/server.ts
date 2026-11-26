import { createLogger } from "@northcrest/common";
import { buildApp } from "./app";
import { FirestoreOverrides } from "./overrides";

const logger = createLogger("flight-status-api");
const app = buildApp(new FirestoreOverrides(), logger);

app
  .listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) })
  .catch((err) => {
    logger.fatal({ err }, "failed to start");
    process.exit(1);
  });
