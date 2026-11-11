import { createApp } from "./app.js";
import { getClientState } from "./ai/client.js";
import { seedDemoUser } from "./auth.js";
import { MemoryStore } from "./store.js";

const port = Number(process.env.PORT ?? 4000);
const store = new MemoryStore();

await seedDemoUser(store);
await getClientState(); // log which Claude credentials are in use at startup

createApp(store).listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});
