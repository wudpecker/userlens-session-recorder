import { record as rrwebRecord, takeFullSnapshot } from "rrweb";
import type { eventWithTime } from "rrweb";
import { getRecordConsolePlugin } from "@rrweb/rrweb-plugin-console-record";

import { uploadSessionEvents } from "./api";
import { generateUuid, saveWriteCode } from "./utils";

import {
  MaskingOption,
  SessionRecorderConfig,
  OnEventsCallback,
  RecorderMode,
  EventBatch,
  AutoModeConfig,
  ManualModeConfig,
} from "./types";

export type {
  SessionRecorderConfig,
  AutoModeConfig,
  ManualModeConfig,
  EventBatch,
  OnEventsCallback,
  MaskingOption,
  RecorderMode,
};

export default class SessionRecorder {
  private mode!: RecorderMode;
  private userId?: string;
  private onEvents?: OnEventsCallback;
  private TIMEOUT!: number;
  private BUFFER_SIZE!: number;
  private maskingOptions!: MaskingOption[];
  private sessionUuid!: string;
  private sessionEvents: eventWithTime[] = [];
  private rrwebStop: ReturnType<typeof rrwebRecord> | null = null;
  private debug = false;

  #trackEventsThrottled: (() => void) | undefined;

  #log(message: string, error?: unknown) {
    if (!this.debug) return;
    if (error) {
      console.error(`[Userlens Session] ${message}`, error);
    } else {
      console.log(`[Userlens Session] ${message}`);
    }
  }

  constructor(config: SessionRecorderConfig) {
    try {
      // Check for browser environment
      if (typeof window === "undefined") return;
      if (typeof document === "undefined") return;
      if (typeof localStorage === "undefined") return;

      // Check for required APIs
      if (typeof CompressionStream === "undefined") return;
      if (typeof MutationObserver === "undefined") return;
      if (typeof TextEncoder === "undefined") return;
      if (typeof fetch === "undefined") return;
      if (typeof Blob === "undefined") return;
      if (typeof crypto === "undefined" || !crypto.getRandomValues) return;

      // Check localStorage actually works (can be blocked even if defined)
      const testKey = "__userlens_test__";
      localStorage.setItem(testKey, "1");
      localStorage.removeItem(testKey);

      // Set debug mode early so it's available for error logging
      this.debug = config.debug ?? false;

      if (config.mode === "manual") {
        this.mode = "manual";
        if (!config.onEvents || typeof config.onEvents !== "function") {
          return;
        }
        this.onEvents = config.onEvents;
      } else {
        this.mode = "auto";
        if (!config.WRITE_CODE?.trim() || !config.userId?.trim()) {
          return;
        }
        saveWriteCode(config.WRITE_CODE);
        this.userId = config.userId;
      }

      const { recordingOptions = {} } = config;
      const {
        TIMEOUT = 30 * 60 * 1000,
        BUFFER_SIZE = 10,
        maskingOptions = ["passwords"],
      } = recordingOptions;

      this.TIMEOUT = TIMEOUT;
      this.BUFFER_SIZE = BUFFER_SIZE;
      this.maskingOptions = maskingOptions;
      this.sessionEvents = [];

      this.#trackEventsThrottled = this.#throttle(() => {
        this.#trackEvents();
      }, 5000);

      this.#initRecorder();
    } catch (err) {
      this.#log("Initialization failed", err);
      return;
    }
  }

  #initRecorder() {
    if (this.rrwebStop) return;

    this.#createSession();

    this.rrwebStop = rrwebRecord({
      emit: (event, isCheckout) => {
        this.#handleEvent(event, isCheckout);
      },
      maskAllInputs: this.maskingOptions.includes("all"),
      maskInputOptions: {
        password: this.maskingOptions.includes("passwords"),
      },
      plugins: [getRecordConsolePlugin()],
      checkoutEveryNth: 100,
    });

    this.#initFocusListener();
  }

  #isUserInteraction(event: eventWithTime): boolean {
    if (event.type === 3) {
      const source = (event.data as { source?: number })?.source;
      return source === 2 || source === 5 || source === 6;
    }
    return false;
  }

  #handleEvent(event: eventWithTime, _isCheckout?: boolean) {
    try {
      const now = Date.now();
      const lastActive = Number(
        localStorage.getItem("userlensSessionLastActive")
      );

      // check inactivity timeout
      if (lastActive && now - lastActive > this.TIMEOUT) {
        this.#resetSession();
        takeFullSnapshot(true);
      }

      // only update lastActive on actual user interactions, not DOM mutations
      if (this.#isUserInteraction(event)) {
        localStorage.setItem("userlensSessionLastActive", now.toString());
      }

      this.sessionEvents.push(event);

      if (this.sessionEvents.length >= this.BUFFER_SIZE) {
        this.#trackEventsThrottled?.();
      }
    } catch (err) {
      this.#log("Event handling failed", err);
    }
  }

  #resetSession() {
    this.#removeLocalSessionData();
    this.#clearEvents();
    this.#createSession();
  }

  #createSession() {
    const now = Date.now();
    const lastActive = Number(
      localStorage.getItem("userlensSessionLastActive")
    );
    const storedUuid = localStorage.getItem("userlensSessionUuid");

    const isExpired = !lastActive || now - lastActive > this.TIMEOUT;

    if (!storedUuid || isExpired) {
      this.sessionUuid = generateUuid();
      localStorage.setItem("userlensSessionUuid", this.sessionUuid);
    } else {
      this.sessionUuid = storedUuid;
    }

    localStorage.setItem("userlensSessionLastActive", now.toString());
  }

  #handleVisibilityChange = () => {
    try {
      if (document.visibilityState === "visible") {
        if (!this.rrwebStop) return;

        const now = Date.now();
        const lastActive = Number(
          localStorage.getItem("userlensSessionLastActive")
        );
        if (lastActive && now - lastActive > this.TIMEOUT) {
          this.#resetSession();
        }

        takeFullSnapshot(true);
      }
    } catch (err) {
      this.#log("Visibility change handling failed", err);
    }
  };

  #initFocusListener() {
    window.addEventListener("visibilitychange", this.#handleVisibilityChange);
  }

  #throttle<T extends (...args: any[]) => void>(
    func: T,
    delay: number
  ): (...args: Parameters<T>) => void {
    let lastCall = 0;
    return (...args: Parameters<T>) => {
      const now = Date.now();

      if (now - lastCall >= delay) {
        lastCall = now;
        func.apply(this, args);
      }
    };
  }

  async #trackEvents() {
    try {
      if (this.sessionEvents.length === 0) {
        return;
      }

      const chunkTimestamp =
        this.sessionEvents[this.sessionEvents.length - 1].timestamp;

      const events = [...this.sessionEvents];
      this.#clearEvents();

      if (this.mode === "manual") {
        if (this.onEvents) {
          this.onEvents({
            sessionId: this.sessionUuid,
            events,
            chunkTimestamp,
          });
        }
      } else {
        await uploadSessionEvents(
          this.userId!,
          this.sessionUuid,
          events,
          chunkTimestamp
        );
      }
    } catch (err) {
      this.#log("Event tracking failed", err);
    }
  }

  #clearEvents() {
    this.sessionEvents = [];
  }

  #removeLocalSessionData() {
    localStorage.removeItem("userlensSessionUuid");
    localStorage.removeItem("userlensSessionLastActive");
  }

  public getSessionId(): string | undefined {
    return this.sessionUuid;
  }

  public stop() {
    try {
      if (!this.rrwebStop) {
        return;
      }

      this.rrwebStop();
      this.rrwebStop = null;

      this.#clearEvents();
      this.#removeLocalSessionData();
      window.removeEventListener(
        "visibilitychange",
        this.#handleVisibilityChange
      );
    } catch (err) {
      this.#log("Stop failed", err);
    }
  }
}
