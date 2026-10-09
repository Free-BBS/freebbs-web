export interface RequestOptions extends RequestInit {
  /** Total transport + body deadline. A positive value overrides the operation default. */
  timeoutMs?: number;
}

export interface RequestRuntime {
  readonly DEFAULT_TIMEOUT_MS: number;
  readonly SESSION_TIMEOUT_MS: number;
  readonly TRANSFER_TIMEOUT_MS: number;
  readonly LONG_OPERATION_TIMEOUT_MS: number;
  timeoutFor(input: RequestInfo | URL, options?: RequestOptions): number;
  run<T>(
    options: Pick<RequestOptions, 'signal' | 'timeoutMs'>,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
  request<T>(
    input: RequestInfo | URL,
    options: RequestOptions,
    consume: (response: Response) => Promise<T>,
    fetchImplementation?: typeof fetch,
  ): Promise<T>;
}

declare global {
  var freeBbsRequests: RequestRuntime;
}
