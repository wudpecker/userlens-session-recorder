import type { eventWithTime } from "rrweb";

import { getWriteCode } from "../utils";

const SESSIONS_BASE_URL = "https://sessions.userlens.io";

// Gzip + base64 encode payload
async function compressAndEncode(data: unknown): Promise<string> {
  const jsonStr = JSON.stringify(data);
  const stream = new Blob([new TextEncoder().encode(jsonStr)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));

  const buffer = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export const uploadSessionEvents = async (
  userId: string,
  sessionUuid: string,
  events: eventWithTime[],
  chunkTimestamp: number
) => {
  const writeCode = getWriteCode();
  if (!writeCode) {
    return;
  }

  // Encode the entire payload - no readable data in request
  const data = {
    userId: userId,
    chunk_timestamp: chunkTimestamp,
    events: events,
  };
  const encodedPayload = await compressAndEncode(data);

  const res = await fetch(`${SESSIONS_BASE_URL}/session/${sessionUuid}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Authorization: `Basic ${writeCode}`,
    },
    body: encodedPayload,
  });

  if (!res.ok) throw new Error("Userlens HTTP error: failed to track");

  return "ok";
};
