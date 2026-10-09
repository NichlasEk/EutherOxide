export type Authorization = {
  authenticated?: boolean;
  user?: string;
  isAdmin?: boolean;
  permissions?: { canServerMap?: boolean };
  csrfToken?: string;
};
export function mayObserve(auth: Authorization): boolean {
  return (
    auth.authenticated === true &&
    typeof auth.user === "string" &&
    !!auth.user &&
    (auth.isAdmin === true || auth.permissions?.canServerMap === true)
  );
}
// Deliberately no generic request(path, method) interface exposed to the inhabitant.
export class ObservationAccess {
  controller = new AbortController();
  private auth: Authorization;
  private transport: typeof fetch;
  constructor(auth: Authorization, transport: typeof fetch = fetch) {
    this.auth = auth;
    this.transport = transport;
    if (!mayObserve(auth)) throw Error("Server Map permission required");
  }
  private async request(path: string, options: RequestInit = {}) {
    if (this.controller.signal.aborted)
      throw Error("Observation access cancelled");
    const timeout = AbortSignal.timeout(35_000);
    const response = await this.transport.call(globalThis, path, {
      ...options,
      credentials: "same-origin",
      signal: AbortSignal.any([this.controller.signal, timeout]),
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": this.auth.csrfToken || "",
      },
    });
    if (response.status === 401 || response.status === 403) {
      this.cancel();
      throw Error("Observation authorization revoked");
    }
    if (!response.ok) throw Error("Observation service unavailable");
    return response.json();
  }
  map() {
    return this.request("/api/admin/euthernet/map");
  }
  authorization() {
    return this.request("/api/auth/status");
  }
  ask(question: string, node: string | null) {
    return this.request("/api/admin/euthernet/ask", {
      method: "POST",
      body: JSON.stringify({
        persona: "scryer",
        question: question.slice(0, 1200),
        node,
      }),
    });
  }
  cancel() {
    this.controller.abort();
  }
}
