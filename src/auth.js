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
  const publicOrigin = env.EXPENSE_PUBLIC_ORIGIN?.trim();
  const passwords = {
    employee: env.DEMO_EMPLOYEE_PASSWORD || 'employee-demo',
    reviewer: env.DEMO_REVIEWER_PASSWORD || 'reviewer-demo',
    authority: env.DEMO_AUTHORITY_PASSWORD || 'authority-demo',
  };
  if (publicOrigin) {
    const origin = new URL(publicOrigin);
    if (origin.protocol !== 'https:' || origin.origin !== publicOrigin) {
      throw new Error('EXPENSE_PUBLIC_ORIGIN must be an exact HTTPS origin without a path.');
    }
    const configured = Object.values(passwords);
    if (new Set(configured).size !== configured.length
      || Object.entries(passwords).some(([role, password]) => password.length < 12 || password === role + '-demo')) {
      throw new Error('Public access requires three distinct passwords other than the demo defaults.');
    }
  }
  const cookie = { httpOnly: true, secure: Boolean(publicOrigin), sameSite: 'strict', path: '/' };

  function requireTrustedOrigin(request, response, next) {
    if (publicOrigin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.get('origin') !== publicOrigin) {
      return response.status(403).json({ message: 'The request came from an unauthorized origin.' });
    }
    next();
  }

  function tokenFrom(request) {
    return request.headers.cookie?.match(/(?:^|;\s*)expense_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  }

  function requireUser(request, response, next) {
    const entry = tokens.get(tokenFrom(request));
    if (!entry || entry.expires < Date.now()) return response.status(401).json({ message: 'Sign in to continue.' });
    request.user = entry.user;
    next();
  }

  function login(request, response) {
    const user = demoUsers.find((entry) => entry.email === request.body?.email?.toString().toLowerCase().trim());
    const password = request.body?.password;
    if (!user || typeof password !== 'string' || !timingSafeEqual(digest(password), digest(passwords[user.id]))) {
      return response.status(401).json({ message: 'Incorrect email address or password.' });
    }
    const token = randomBytes(32).toString('hex');
    const maxAge = 8 * 60 * 60 * 1000;
    tokens.set(token, { user, expires: Date.now() + maxAge });
    response.cookie('expense_session', token, { ...cookie, maxAge });
    response.json({ user });
  }

  function logout(request, response) {
    tokens.delete(tokenFrom(request));
    response.clearCookie('expense_session', cookie).sendStatus(204);
  }

  return { requireUser, requireTrustedOrigin, login, logout };
}
