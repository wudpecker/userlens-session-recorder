export function generateUuid(): string {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (
      Number(c) ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))
    ).toString(16)
  );
}

export function saveWriteCode(writeCode: string) {
  window.localStorage.setItem("$ul_WRITE_CODE", btoa(`${writeCode}:`));
}

export const getWriteCode = (): string | null => {
  try {
    const raw = window.localStorage.getItem("$ul_WRITE_CODE");
    if (raw == null) return null;

    const val = raw.trim();
    if (!val) return null;

    const lower = val.toLowerCase();
    if (lower === "null" || lower === "undefined") return null;

    return val;
  } catch {
    return null;
  }
};
