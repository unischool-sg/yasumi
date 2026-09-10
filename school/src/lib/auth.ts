export interface TeacherPrincipal {
  id: string;
  schoolId: string;
  role: "owner" | "teacher";
  email: string;
  name: string;
}
export interface Auth {
  token: string;
  teacher: TeacherPrincipal;
}

const KEY = "yasumi_school_auth";

export function getAuth(): Auth | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Auth;
  } catch {
    return null;
  }
}

export function setAuth(auth: Auth): void {
  localStorage.setItem(KEY, JSON.stringify(auth));
}

export function clearAuth(): void {
  localStorage.removeItem(KEY);
}
