import { createLogger } from "@northcrest/common";
import { buildApp } from "./app";
import { FirestoreBookingStore } from "./store";

const logger = createLogger("booking-api");
const app = buildApp(new FirestoreBookingStore(), logger);

app
  .listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) })
  .catch((err) => {
    logger.fatal({ err }, "failed to start");
    process.exit(1);
  });
