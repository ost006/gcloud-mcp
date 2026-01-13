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

import { AsyncLocalStorage } from 'node:async_hooks';
import { GcpCredentials } from './auth.js';

export interface AuthContext {
  credentials: GcpCredentials;
}

// AsyncLocalStorage for request-scoped credentials
export const authContextStorage = new AsyncLocalStorage<AuthContext>();

/**
 * Get the current credentials from the async context.
 * Returns undefined if no credentials are set in the current context.
 */
export function getCurrentCredentials(): GcpCredentials | undefined {
  const context = authContextStorage.getStore();
  return context?.credentials;
}

/**
 * Run a function with the given credentials in the async context.
 */
export function runWithCredentials<T>(credentials: GcpCredentials, fn: () => T): T {
  return authContextStorage.run({ credentials }, fn);
}

/**
 * Run an async function with the given credentials in the async context.
 */
export async function runWithCredentialsAsync<T>(
  credentials: GcpCredentials,
  fn: () => Promise<T>,
): Promise<T> {
  return authContextStorage.run({ credentials }, fn);
}
