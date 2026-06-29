import { BaseApiClient, ApiClientConfig, ApiResponse } from '../base/BaseApiClient';

export interface User {
  id?: number;
  name: string;
  email: string;
  role?: string;
}

export class UserApiClient extends BaseApiClient {
  constructor(request: ConstructorParameters<typeof BaseApiClient>[0], config: ApiClientConfig) {
    super(request, config);
  }

  async getAll(): Promise<ApiResponse<User[]>> {
    return this.get<User[]>('/users');
  }

  async getById(id: number): Promise<ApiResponse<User>> {
    return this.get<User>(`/users/${id}`);
  }

  async createUser(payload: Omit<User, 'id'>): Promise<ApiResponse<User>> {
    return this.post<User>('/users', payload);
  }

  async updateUser(id: number, payload: Partial<User>): Promise<ApiResponse<User>> {
    return this.put<User>(`/users/${id}`, payload);
  }

  async deleteUser(id: number): Promise<ApiResponse<void>> {
    return this.delete<void>(`/users/${id}`);
  }
}
