/**
 * @vazhikara/server — entrypoint.
 *
 * Authoritative game server: rooms in memory, every client intent validated
 * through @vazhikara/engine, state broadcast with per-viewer redaction over
 * Socket.IO. See server.ts for the wiring and protocol.ts for the wire types.
 */

import { ENGINE_NAME } from "@vazhikara/engine";
import { createGameServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3001);

const { httpServer } = createGameServer();

httpServer.listen(PORT, () => {
  console.log(`[${ENGINE_NAME}] server listening on http://localhost:${PORT}`);
});

export { createGameServer } from "./server.js";
export * from "./protocol.js";
