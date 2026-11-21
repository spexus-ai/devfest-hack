import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const demoUsers = [
  { id: 'employee', name: 'Jamie Chen', email: 'employee@example.test', role: 'claimant', managerId: 'reviewer' },
  { id: 'reviewer', name: 'Taylor Morgan', email: 'reviewer@example.test', role: 'reviewer', managerId: 'authority',
    exceptionAuthority: 'supervisor' },
  { id: 'authority', name: 'Casey Rivera', email: 'authority@example.test', role: 'reviewer',
    exceptionAuthority: 'higher' },
];

const digest = (value) => createHash('sha256').update(value).digest();

export function canReadSession(user, session) {
  return user && session && [session.claimantId, session.approverId].includes(user.id);
}

export function canApprove(user, session) {
  return user?.role === 'reviewer'
    && user.id === session?.approverId
    && user.id !== session?.claimantId
    && user.managerId !== session?.claimantId;
}

export function createAuth(env = process.env) {
  const tokens = new Map();
  const passwords = {
    employee: env.DEMO_EMPLOYEE_PASSWORD || 'employee-demo',
    reviewer: env.DEMO_REVIEWER_PASSWORD || 'reviewer-demo',
    authority: env.DEMO_AUTHORITY_PASSWORD || 'authority-demo',
  };

  function tokenFrom(request) {
    return request.headers.cookie?.match(/(?:^|;\s*)expense_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  }

  function requireUser(request, response, next) {
    const entry = tokens.get(tokenFrom(request));
    if (!entry || entry.expires < Date.now()) return response.status(401).json({ message: 'Войдите в систему.' });
    request.user = entry.user;
    next();
  }

  function login(request, response) {
    const user = demoUsers.find((entry) => entry.email === request.body?.email?.toString().toLowerCase().trim());
    const password = request.body?.password;
    if (!user || typeof password !== 'string' || !timingSafeEqual(digest(password), digest(passwords[user.id]))) {
      return response.status(401).json({ message: 'Неверный адрес или пароль.' });
    }
    const token = randomBytes(32).toString('hex');
    const maxAge = 8 * 60 * 60 * 1000;
    tokens.set(token, { user, expires: Date.now() + maxAge });
    response.cookie('expense_session', token, { httpOnly: true, sameSite: 'strict', path: '/', maxAge });
    response.json({ user });
  }

  function logout(request, response) {
    tokens.delete(tokenFrom(request));
    response.clearCookie('expense_session', { path: '/' }).sendStatus(204);
  }

  return { requireUser, login, logout };
}
