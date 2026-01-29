import type { eventWithTime } from "rrweb";

export type MaskingOption = "passwords" | "all";
export type RecorderMode = "auto" | "manual";

export interface SessionRecordingOptions {
  TIMEOUT?: number;
  BUFFER_SIZE?: number;
  maskingOptions?: MaskingOption[];
  recordCrossOriginIframes?: boolean;
}

export interface EventBatch {
  sessionId: string;
  events: eventWithTime[];
  chunkTimestamp: number;
}

export type OnEventsCallback = (batch: EventBatch) => void;

// Auto mode config - uploads to Userlens backend
export interface AutoModeConfig {
  mode?: "auto";
  WRITE_CODE: string;
  userId: string;
  recordingOptions?: SessionRecordingOptions;
  debug?: boolean;
}

// Manual mode config - events pushed to callback
export interface ManualModeConfig {
  mode: "manual";
  onEvents: OnEventsCallback;
  recordingOptions?: SessionRecordingOptions;
  debug?: boolean;
}

export type SessionRecorderConfig = AutoModeConfig | ManualModeConfig;
