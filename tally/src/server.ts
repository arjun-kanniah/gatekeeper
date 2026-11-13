import { createServer } from "node:http";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { seedUsers } from "./seed.ts";

const db = openDb(process.env.TALLY_DB ?? "tally.db");
seedUsers(db);

const port = Number(process.env.PORT ?? 3000);
createServer(createApp(db)).listen(port, () => {
  console.log(`tally listening on http://localhost:${port}`);
});
