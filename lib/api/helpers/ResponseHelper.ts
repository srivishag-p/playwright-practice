import { expect } from '@playwright/test';
import { ApiResponse } from '../base/BaseApiClient';

export class ResponseHelper {
  static expectStatus(response: ApiResponse, expectedStatus: number): void {
    expect(
      response.status,
      `Expected status ${expectedStatus} but got ${response.status}`
    ).toBe(expectedStatus);
  }

  static expectBodyContains<T>(response: ApiResponse<T>, key: keyof T, value: unknown): void {
    expect(response.body[key]).toBe(value);
  }

  static expectArrayLength<T>(response: ApiResponse<T[]>, length: number): void {
    expect(Array.isArray(response.body)).toBeTruthy();
    expect((response.body as unknown[]).length).toBe(length);
  }

  static expectNonEmptyArray<T>(response: ApiResponse<T[]>): void {
    expect(Array.isArray(response.body)).toBeTruthy();
    expect((response.body as unknown[]).length).toBeGreaterThan(0);
  }

  static expectHeader(response: ApiResponse, header: string, value: string): void {
    expect(response.headers[header.toLowerCase()]).toContain(value);
  }
}
