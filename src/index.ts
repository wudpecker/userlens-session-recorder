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

  #trackEventsThrottled;

  constructor(config: SessionRecorderConfig) {
    if (typeof window === "undefined") {
      return;
    }

    if (config.mode === "manual") {
      // Manual mode
      this.mode = "manual";

      if (!config.onEvents || typeof config.onEvents !== "function") {
        console.error(
          "Userlens SDK Error: onEvents callback is required in manual mode"
        );
        return;
      }

      this.onEvents = config.onEvents;
    } else {
      // Auto mode (default)
      this.mode = "auto";

      if (!config.WRITE_CODE?.trim()) {
        console.error(
          "Userlens SDK Error: WRITE_CODE is required and must be a string"
        );
        return;
      }
      if (!config.userId?.trim()) {
        console.error(
          "Userlens SDK Error: userId is required to identify session user."
        );
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
  }

  #initRecorder() {
    if (this.rrwebStop) return;

    this.#createSession();

    setTimeout(() => {
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
    }, 100);

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
  }

  #resetSession() {
    this.#removeLocalSessionData();
    this.#clearEvents();
    this.#createSession();
  }

  #createSession() {
    const lastActive = Number(
      localStorage.getItem("userlensSessionLastActive")
    );
    const storedUuid = localStorage.getItem("userlensSessionUuid");

    const now = Date.now();
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
    if (this.sessionEvents.length === 0) {
      return;
    }

    const chunkTimestamp =
      this.sessionEvents[this.sessionEvents.length - 1].timestamp;

    const events = [...this.sessionEvents];
    this.#clearEvents();

    if (this.mode === "manual") {
      // Manual mode - push events to callback
      if (this.onEvents) {
        try {
          this.onEvents({
            sessionId: this.sessionUuid,
            events,
            chunkTimestamp,
          });
        } catch (_) {
          // Don't stop on callback errors in manual mode
        }
      }
    } else {
      // Auto mode - upload to Userlens backend
      try {
        await uploadSessionEvents(
          this.userId!,
          this.sessionUuid,
          events,
          chunkTimestamp
        );
      } catch (_) {
        this.stop();
      }
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
  }
}
