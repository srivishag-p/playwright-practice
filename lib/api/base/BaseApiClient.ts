import { APIRequestContext, APIResponse } from '@playwright/test';
import { logger } from '@utils/logger';

export interface ApiClientConfig {
  baseURL: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

export abstract class BaseApiClient {
  protected readonly request: APIRequestContext;
  protected readonly config: ApiClientConfig;

  constructor(request: APIRequestContext, config: ApiClientConfig) {
    this.request = request;
    this.config = config;
  }

  protected async get<T>(path: string, params?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.execute<T>('GET', path, { params });
  }

  protected async post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this.execute<T>('POST', path, { data: body });
  }

  protected async put<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this.execute<T>('PUT', path, { data: body });
  }

  protected async patch<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this.execute<T>('PATCH', path, { data: body });
  }

  protected async delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.execute<T>('DELETE', path, {});
  }

  private async execute<T>(
    method: string,
    path: string,
    options: Record<string, unknown>
  ): Promise<ApiResponse<T>> {
    const url = `${this.config.baseURL}${path}`;
    logger.info(`API ${method} ${url}`);

    const response: APIResponse = await this.request.fetch(url, {
      method,
      headers: this.config.defaultHeaders,
      timeout: this.config.timeout ?? 30_000,
      ...options,
    });

    const body = await this.safeJson<T>(response);
    logger.debug(`Response ${response.status()} from ${url}`);

    return {
      status: response.status(),
      body,
      headers: response.headers() as Record<string, string>,
    };
  }

  private async safeJson<T>(response: APIResponse): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      return {} as T;
    }
  }

  // Override in subclasses to inject auth token/cookie
  async authenticate(_credentials?: Record<string, string>): Promise<void> {}
}
