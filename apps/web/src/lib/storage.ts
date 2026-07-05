/** localStorage helpers for nickname persistence and per-room reconnect tokens. */

const NICKNAME_KEY = "vaz:nickname";

export function loadNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveNickname(nickname: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, nickname);
  } catch {
    // ignore (private browsing etc.)
  }
}

export interface StoredRoomAuth {
  token: string;
  nickname: string;
}

function roomKey(code: string): string {
  return `vaz:room:${code.toUpperCase()}`;
}

export function loadRoomAuth(code: string): StoredRoomAuth | null {
  try {
    const raw = localStorage.getItem(roomKey(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredRoomAuth>;
    if (typeof parsed.token !== "string" || typeof parsed.nickname !== "string") return null;
    return { token: parsed.token, nickname: parsed.nickname };
  } catch {
    return null;
  }
}

export function saveRoomAuth(code: string, auth: StoredRoomAuth): void {
  try {
    localStorage.setItem(roomKey(code), JSON.stringify(auth));
  } catch {
    // ignore
  }
}

export function clearRoomAuth(code: string): void {
  try {
    localStorage.removeItem(roomKey(code));
  } catch {
    // ignore
  }
}
