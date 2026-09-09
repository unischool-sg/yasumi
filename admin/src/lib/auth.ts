export interface AdminPrincipal {
  id: string;
  username: string;
  role: "superadmin" | "admin";
}
export interface Auth {
  token: string;
  admin: AdminPrincipal;
}

const KEY = "yasumi_admin_auth";

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

export function isSuperadmin(): boolean {
  return getAuth()?.admin.role === "superadmin";
}
