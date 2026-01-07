export type MaskingOption = "passwords" | "all";
export interface SessionRecordingOptions {
  TIMEOUT?: number;
  BUFFER_SIZE?: number;
  maskingOptions?: MaskingOption[];
}

export interface SessionRecorderConfig {
  WRITE_CODE: string;
  userId: string;
  recordingOptions?: SessionRecordingOptions;
}
