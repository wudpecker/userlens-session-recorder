import type { eventWithTime } from "rrweb";

import { getWriteCode } from "../utils";

const SESSIONS_BASE_URL = "https://sessions.userlens.io";

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

  const body = {
    userId: userId,
    chunk_timestamp: chunkTimestamp,
    payload: events,
  };

  const res = await fetch(`${SESSIONS_BASE_URL}/session/${sessionUuid}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${writeCode}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error("Userlens HTTP error: failed to track");

  return "ok";
};
