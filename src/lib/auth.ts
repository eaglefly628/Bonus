import { cookies, headers } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db';

export const cookieName = 'ap_session';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export async function currentUser() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: hash(token) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date() || !session.user.active) return null;
  return { id: session.user.id, username: session.user.username, role: session.user.role };
}
export async function login(username: string, password: string) {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = hash(`${ip}:${username.toLowerCase()}`);
  const since = new Date(Date.now() - 15 * 60_000);
  const attempts = await db.loginAttempt.count({ where: { key, createdAt: { gte: since } } });
  if (attempts >= 8) throw new Error('登录尝试过多，请 15 分钟后重试');
  const user = await db.user.findUnique({ where: { username } });
  const valid = user?.active && await bcrypt.compare(password, user.passwordHash);
  if (!user || !valid) {
    await db.loginAttempt.create({ data: { key } });
    throw new Error('用户名或密码错误');
  }
  await db.loginAttempt.deleteMany({ where: { key } });
  const token = randomBytes(32).toString('base64url');
  await db.session.create({ data: { userId: user.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + 30 * 86400_000) } });
  (await cookies()).set(cookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 30 * 86400 });
  return { id: user.id, username: user.username, role: user.role };
}
export async function logout() {
  const c = await cookies();
  const token = c.get(cookieName)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hash(token) } });
  c.delete(cookieName);
}
export function requireAdmin(user: { role: string } | null): asserts user is { role: string } {
  if (!user || user.role !== 'ADMIN') throw new Error('无权限');
}
