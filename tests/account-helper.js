import { randomUUID } from 'node:crypto';
import { createStore } from '../server/store.js';
import { createAuthService } from '../server/auth.js';

export async function provisionTestAccount(directory, username = `t-${randomUUID()}`) {
  const store = createStore(directory);
  const password = `Test-${randomUUID()}`;
  try {
    const user = await createAuthService(store).createAccount(username, password);
    return { ...user, password };
  } finally {
    store.db.close();
  }
}
export async function loginTestAccount(origin, directory) {
  const user = await provisionTestAccount(directory);
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, password: user.password }),
  });
  if (!response.ok) throw new Error(`Test login failed: ${response.status}`);
  return response;
}
