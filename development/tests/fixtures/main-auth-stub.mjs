import { createServer } from 'node:http';
import process from 'node:process';

const host = '127.0.0.1';
const port = Number(process.env.MAIN_AUTH_STUB_PORT ?? '3200');
const identities = new Map([
  [
    'production-admin-token',
    {
      uid: 'demo-admin',
      fullName: '发展端管理员',
      avatarPath: null,
    },
  ],
  [
    'production-student-token',
    {
      uid: 'main-site-student',
      fullName: '主站同步同学',
      avatarPath: null,
    },
  ],
]);

function send(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }
  if (request.method !== 'GET' || request.url !== '/api/auth/me') {
    send(response, 404, { error: 'not_found' });
    return;
  }

  const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? '');
  const identity = match?.[1] ? identities.get(match[1]) : undefined;
  if (identity === undefined) {
    send(response, 401, { error: 'invalid_token' });
    return;
  }
  send(response, 200, { data: { user: identity } });
});

server.listen(port, host);

function close() {
  server.close((error) => {
    if (error) {
      process.stderr.write(`Main auth stub shutdown failed: ${error.message}\n`);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', close);
process.once('SIGTERM', close);
