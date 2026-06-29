import * as path from 'path';
import * as fs from 'fs';

export const AUTH_DIR       = path.resolve(process.cwd(), 'environments/.auth');
export const BC_AUTH_FILE   = path.join(AUTH_DIR, 'bc-user.json');

export function authStateExists(): boolean {
  return fs.existsSync(BC_AUTH_FILE);
}

export function clearAuthState(): void {
  if (fs.existsSync(BC_AUTH_FILE)) fs.unlinkSync(BC_AUTH_FILE);
}
