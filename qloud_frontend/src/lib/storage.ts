// localStorage can throw (blocked site data, some private modes); preferences
// are a convenience, so failures must never break the app.
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore: the preference just won't persist.
  }
}
