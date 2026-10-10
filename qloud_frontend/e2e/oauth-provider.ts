/**
 * A fake Google and GitHub for E2E, started by playwright.config.ts and wired
 * in by Django's config.settings.e2e. Run with `node e2e/oauth-provider.ts`.
 *
 * The authorize page is a form where the test picks the identity the provider
 * returns. That identity travels inside the code and the access token, so the
 * server keeps no state and parallel tests cannot see each other's logins.
 */
import { createHash } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';

const PORT = Number(process.env.PORT ?? 8002);

interface Identity {
  email: string;
  name: string;
  verified: boolean;
}

const encode = (identity: Identity): string =>
  Buffer.from(JSON.stringify(identity)).toString('base64url');

function decode(token: string | undefined): Identity | null {
  if (!token) return null;
  try {
    return JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8'),
    ) as Identity;
  } catch {
    return null;
  }
}

/** Same email, same provider account: a second login finds the first one. */
const uid = (email: string): string =>
  createHash('sha256').update(email).digest('hex').slice(0, 16);

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

function send(
  response: ServerResponse,
  status: number,
  body: unknown,
  type = 'application/json',
): void {
  response.writeHead(status, { 'Content-Type': type });
  response.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function authorizePage(provider: string, query: URLSearchParams): string {
  const hidden = ['redirect_uri', 'state']
    .map(
      (name) =>
        `<input type="hidden" name="${name}" value="${escapeHtml(query.get(name) ?? '')}">`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>Fake ${provider}</title>
<h1>Fake ${provider}</h1>
<form method="get" action="/${provider}/approve">${hidden}
<label>Email <input name="email" type="email"></label>
<label>Name <input name="name"></label>
<label><input name="verified" type="checkbox" checked> Verified</label>
<button type="submit">Allow</button>
</form>`;
}

function profile(provider: string, path: string, identity: Identity): unknown {
  const id = uid(identity.email);
  if (provider === 'google' && path === '/userinfo') {
    return {
      id,
      sub: id,
      email: identity.email,
      verified_email: identity.verified,
      email_verified: identity.verified,
      name: identity.name,
    };
  }
  if (provider === 'github' && path === '/api/v3/user') {
    return {
      id,
      login: identity.email.split('@')[0],
      name: identity.name,
      email: identity.email,
    };
  }
  if (provider === 'github' && path === '/api/v3/user/emails') {
    return [
      { email: identity.email, primary: true, verified: identity.verified },
    ];
  }
  return undefined;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const [, provider = '', ...rest] = url.pathname.split('/');
  const path = `/${rest.join('/')}`;

  if (url.pathname === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }
  if (provider !== 'google' && provider !== 'github') {
    send(response, 404, { error: 'not_found' });
    return;
  }
  if (path === '/authorize' || path === '/login/oauth/authorize') {
    send(response, 200, authorizePage(provider, url.searchParams), 'text/html');
    return;
  }
  if (path === '/approve') {
    const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
    redirect.searchParams.set(
      'code',
      encode({
        email: url.searchParams.get('email') ?? '',
        name: url.searchParams.get('name') ?? '',
        verified: url.searchParams.has('verified'),
      }),
    );
    redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
    response.writeHead(302, { Location: redirect.toString() });
    response.end();
    return;
  }
  if (path === '/token' || path === '/login/oauth/access_token') {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      const code = new URLSearchParams(body).get('code') ?? '';
      if (!decode(code)) {
        send(response, 400, { error: 'invalid_grant' });
        return;
      }
      send(response, 200, { access_token: code, token_type: 'bearer' });
    });
    return;
  }
  // "Bearer <token>" (Google) or "token <token>" (GitHub).
  const token = request.headers.authorization?.split(' ')[1];
  const identity = decode(token);
  const body = identity ? profile(provider, path, identity) : undefined;
  if (!identity) send(response, 401, { error: 'invalid_token' });
  else if (body === undefined) send(response, 404, { error: 'not_found' });
  else send(response, 200, body);
});

server.listen(PORT, '127.0.0.1');
