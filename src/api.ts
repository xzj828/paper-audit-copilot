export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${url}`, {
      ...options,
      headers:
        options.body instanceof FormData
          ? options.headers
          : { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError'))
      throw error;
    throw new ApiError('无法连接应用服务，请检查应用服务是否正在运行及网络连接后重试。', 0);
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      data?.error ||
        ([401, 403].includes(response.status) ? '当前浏览器无权访问此资源' : '请求失败，请重试'),
      response.status,
    );
  if (data === null) throw new ApiError('服务返回了无法读取的数据，请重试', response.status);
  return data;
}
export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});
