// Where the real backend lives, e.g. http://192.168.1.20:3000 (no trailing slash needed).
// Set it in frontend/.env as EXPO_PUBLIC_API_URL; Expo copies EXPO_PUBLIC_* values into the app.
// When it's empty the app uses the in-memory mock instead, so it always runs.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');

export const USING_MOCK = API_URL === '';
