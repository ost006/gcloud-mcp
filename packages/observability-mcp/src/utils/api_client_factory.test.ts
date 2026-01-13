/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *	http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { ApiClientFactory as ApiClientFactoryClass } from './api_client_factory.js';
import { GcpCredentials } from './auth.js';
import { runWithCredentials } from './auth_context.js';

// Mock the googleapis library
vi.mock('googleapis', () => ({
  google: {
    monitoring: vi.fn(() => ({})),
    logging: vi.fn(() => ({})),
    clouderrorreporting: vi.fn(() => ({})),
    cloudtrace: vi.fn(() => ({})),
  },
}));

// Mock the google-auth-library
vi.mock('google-auth-library');

const mockCredentials: GcpCredentials = {
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'key-id',
  private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
  client_email: 'test@test-project.iam.gserviceaccount.com',
  client_id: '123456789',
};

describe('ApiClientFactory', () => {
  let ApiClientFactory: typeof ApiClientFactoryClass;

  beforeEach(async () => {
    // Reset mocks and the module cache before each test
    vi.resetModules();
    vi.clearAllMocks();
    // Re-import the module to get a fresh instance
    ApiClientFactory = (await import('./api_client_factory.js')).ApiClientFactory;
  });

  it('should use the correct auth scopes when created with credentials', () => {
    ApiClientFactory.createWithCredentials(mockCredentials);
    expect(GoogleAuth).toHaveBeenCalledWith({
      credentials: {
        type: mockCredentials.type,
        client_email: mockCredentials.client_email,
        private_key: mockCredentials.private_key,
      },
      projectId: mockCredentials.project_id,
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
  });

  it('should throw error when no credentials in context', () => {
    expect(() => ApiClientFactory.getInstanceForCurrentContext()).toThrow(
      'No credentials found in current context',
    );
  });

  it('should get instance from context when credentials are available', () => {
    runWithCredentials(mockCredentials, () => {
      const factory = ApiClientFactory.getInstanceForCurrentContext();
      expect(factory).toBeDefined();
      expect(GoogleAuth).toHaveBeenCalled();
    });
  });

  it('should create and cache the monitoring client', () => {
    const factory = ApiClientFactory.createWithCredentials(mockCredentials);
    const client1 = factory.getMonitoringClient();
    const client2 = factory.getMonitoringClient();
    expect(client1).toBe(client2);
    expect(google.monitoring).toHaveBeenCalledTimes(1);
  });

  it('should create and cache the logging client', () => {
    const factory = ApiClientFactory.createWithCredentials(mockCredentials);
    const client1 = factory.getLoggingClient();
    const client2 = factory.getLoggingClient();
    expect(client1).toBe(client2);
    expect(google.logging).toHaveBeenCalledTimes(1);
  });

  it('should create and cache the error reporting client', () => {
    const factory = ApiClientFactory.createWithCredentials(mockCredentials);
    const client1 = factory.getErrorReportingClient();
    const client2 = factory.getErrorReportingClient();
    expect(client1).toBe(client2);
    expect(google.clouderrorreporting).toHaveBeenCalledTimes(1);
  });

  it('should create and cache the trace client', () => {
    const factory = ApiClientFactory.createWithCredentials(mockCredentials);
    const client1 = factory.getTraceClient();
    const client2 = factory.getTraceClient();
    expect(client1).toBe(client2);
    expect(google.cloudtrace).toHaveBeenCalledTimes(1);
  });
});
