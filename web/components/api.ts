export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { ...options, credentials: "same-origin", cache: "no-store", signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, "网络连接中断或请求超时，请检查连接后重试");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = response.status === 404 ? "平台登录服务尚未配置，请联系管理员" : response.status === 429 ? "操作过于频繁，请稍后重试" : body?.message ?? "服务暂不可用，请稍后重试";
    throw new ApiError(response.status, message);
  }
  return response.status === 204 ? undefined as T : response.json();
}
