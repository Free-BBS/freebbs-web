import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../..');

function configuration(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

function composeService(compose: string, name: string): string {
  const heading = new RegExp(`^ {2}${name}:\\s*$`, 'm').exec(compose);
  if (!heading) return '';
  const start = heading.index;
  const bodyStart = start + heading[0].length;
  const followingService = compose.slice(bodyStart).search(/^ {2}[a-z][a-z-]*:\s*$/m);
  return followingService === -1
    ? compose.slice(start)
    : compose.slice(start, bodyStart + followingService);
}

describe('deployment configuration', () => {
  it('keeps the default Compose stack usable as an in-memory demo', () => {
    const compose = configuration('docker-compose.yml');

    expect(compose).toContain('DATA_MODE: ${DATA_MODE:-memory}');
    expect(compose).toContain('AUTH_MODE: ${AUTH_MODE:-demo}');
    expect(compose).toContain('NODE_ENV: ${NODE_ENV:-development}');
    const secretValues = [...compose.matchAll(/^\s+\w*(?:PASSWORD|SECRET)\w*:\s*(.+)$/gim)].map(
      ([, value]) => value.trim(),
    );
    expect(secretValues.length).toBeGreaterThan(0);
    expect(secretValues.every((value) => /^\$\{[A-Z0-9_]+:-\}$/.test(value))).toBe(true);
  });

  it('offers private MySQL and opt-in, loopback-only Adminer services', () => {
    const compose = configuration('docker-compose.yml');

    expect(compose).toContain('database:');
    expect(compose).toContain('profiles: [mysql, adminer, seed]');
    const database = composeService(compose, 'database');
    expect(database).toMatch(/expose:\s*\n\s*- ["']3306["']/);
    expect(database).toContain('127.0.0.1:${MYSQL_PORT:-3306}:3306');
    expect(database).not.toMatch(/\n\s+- ['"]?3306:3306/);
    expect(compose).toContain('adminer:');
    expect(compose).toContain('profiles: [adminer]');
    expect(compose).toContain('127.0.0.1:${ADMINER_PORT:-8081}:8080');
  });

  it('gates real MySQL 8 integration without exposing the database publicly', () => {
    const packageJson = JSON.parse(configuration('package.json')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts['test:mysql']).toBe(
      'npm run build:contracts && npm run db:migrate && npm run db:migrate && vitest run apps/api/src/core/database/mysql.integration.test.ts',
    );

    const workflow = configuration('.github/workflows/ci.yml');
    expect(workflow).toContain('image: mysql:8.4');
    expect(workflow).toContain('run: npm run test:mysql');

    const database = composeService(configuration('docker-compose.yml'), 'database');
    expect(database).toContain('127.0.0.1:${MYSQL_PORT:-3306}:3306');
    expect(database).not.toMatch(/\n\s+- ['"]?3306:3306/);

    const dockerignore = configuration('.dockerignore');
    for (const entry of [
      '.git',
      '.worktrees',
      'node_modules',
      '**/dist',
      '.env*',
      '**/.env*',
      '!**/.env.example',
      'playwright-report',
      'test-results',
      'coverage',
    ]) {
      expect(dockerignore).toContain(entry);
    }
  });
  it('routes the development SPA and versioned API without losing the request path', () => {
    const nginx = configuration('deploy/nginx/freebbs-development.conf');
    const hostLocations = configuration('deploy/nginx/freebbs-development.locations.conf');

    expect(nginx).toMatch(/location\s+=\s+\/development\s*{\s*return\s+308\s+\/development\/;/);
    expect(nginx).toMatch(
      /location\s+\/development\/\s*{[\s\S]*?try_files[^;]+\/development\/index\.html;/,
    );
    expect(nginx).toMatch(
      /location\s+\/api\/development\/v1\/\s*{[\s\S]*?proxy_pass\s+http:\/\/127\.0\.0\.1:3100;/,
    );
    expect(nginx).toContain('proxy_set_header Authorization $http_authorization;');
    expect(hostLocations).not.toMatch(/\bserver\s*{/);
    expect(hostLocations).not.toMatch(/\blisten\s+/);
    expect(hostLocations).not.toMatch(/location\s+=\s+\/development\s*{/);
    expect(hostLocations).toMatch(/location\s+\/development\/\s*{/);
    expect(hostLocations).toMatch(/location\s+\/api\/development\/v1\/\s*{/);
  });

  it('runs both application images without root privileges and with health checks', () => {
    const compose = configuration('docker-compose.yml');
    const apiDockerfile = configuration('deploy/docker/api.Dockerfile');
    const webDockerfile = configuration('deploy/docker/web.Dockerfile');

    expect(apiDockerfile).toMatch(/\nUSER node\s*\n/);
    expect(webDockerfile).toMatch(/\nUSER 101\s*\n/);
    expect(compose.match(/healthcheck:/g)).toHaveLength(4);
  });

  it('makes deterministic demo seeding explicit and keeps its safety gate', () => {
    const compose = configuration('docker-compose.yml');
    const apiDockerfile = configuration('deploy/docker/api.Dockerfile');
    const seed = composeService(compose, 'seed');

    expect(composeService(compose, 'database')).toContain('profiles: [mysql, adminer, seed]');
    expect(composeService(compose, 'migrate')).toContain('profiles: [mysql, adminer, seed]');
    expect(seed).toContain('profiles: [seed]');
    expect(seed).toContain("command: ['node', 'scripts/seed.mjs']");
    expect(seed).toContain("NODE_ENV: 'development'");
    expect(seed).toContain("ALLOW_DEMO_SEED: 'true'");
    expect(seed).not.toContain('ALLOW_PRODUCTION_DEMO_SEED');
    expect(apiDockerfile).toContain('COPY scripts scripts');
    expect(apiDockerfile).toContain('COPY database/seeds database/seeds');
  });

  it('uses the production environment file and hardens both systemd units', () => {
    for (const unit of [
      configuration('deploy/systemd/freebbs-development-api.service'),
      configuration('deploy/systemd/freebbs-development-web.service'),
    ]) {
      expect(unit).toContain('EnvironmentFile=/etc/freebbs-development/development.env');
      expect(unit).toContain('NoNewPrivileges=true');
      expect(unit).toContain('PrivateTmp=true');
      expect(unit).toContain('ProtectSystem=strict');
      expect(unit).toContain('ProtectHome=true');
    }

    const webUnit = configuration('deploy/systemd/freebbs-development-web.service');
    const apiUnit = configuration('deploy/systemd/freebbs-development-api.service');
    expect(apiUnit).toContain(
      'ExecStart=/usr/bin/env NODE_ENV=production HOST=127.0.0.1 /usr/bin/node apps/api/dist/server.js',
    );
    expect(webUnit).toContain('Type=oneshot');
    expect(webUnit).toContain('Requires=nginx.service');
    expect(webUnit).not.toContain('daemon off;');
    expect(webUnit).not.toContain('nginx -t');
  });
  it('ships installable atomic release and backup configuration', () => {
    const deployScript = configuration('scripts/deploy-release.sh');
    const installer = configuration('scripts/install-server.sh');
    const environment = configuration('deploy/env/development.env.example');
    const backupService = configuration('deploy/systemd/freebbs-development-backup.service');
    const backupTimer = configuration('deploy/systemd/freebbs-development-backup.timer');

    expect(deployScript).toContain('.release-sha');
    expect(deployScript).toContain('FREEBBS_APP_ROOT');
    expect(deployScript).toContain('rollback');
    expect(deployScript).not.toContain('db:seed');
    expect(installer).toContain('/usr/local/sbin/deploy-freebbs-development');
    expect(installer).toContain('-m 0640');
    expect(environment).toContain('DATA_MODE=mysql');
    expect(environment).toContain('DEVELOPMENT_PREVIEW_UIDS=');
    expect(backupService).toContain('ReadWritePaths=/var/backups/freebbs-development');
    expect(backupService).toContain('EnvironmentFile=/etc/freebbs-development/backup.env');
    expect(backupTimer).toContain('Persistent=true');
  });
  it('documents the exact protected production release contract', () => {
    const checklist = configuration('docs/production-release-checklist.md');
    const index = configuration('docs/README.md');
    const rootReadme = configuration('README.md');

    for (const value of [
      'FREEBBS_DOMAIN',
      'FIRST_SUPER_ADMIN_UID',
      'RELEASE_SHA',
      'PREVIOUS_RELEASE_SHA',
      'sudo scripts/install-server.sh',
      '/etc/freebbs-development/development.env',
      '/etc/freebbs-development/backup.env',
      'production-database',
      'scripts/create-release-archive.sh',
      '/usr/local/sbin/deploy-freebbs-development',
      'http://127.0.0.1:3100/api/development/v1/health',
      'http://127.0.0.1:3100/api/development/v1/ready',
      '--rollback-to',
      '/development/',
    ]) {
      expect(checklist).toContain(value);
    }
    expect(checklist).toMatch(/protected\s+`main`/i);
    expect(checklist).toMatch(/self-hosted[\s\S]*production-database/);
    expect(checklist).toMatch(/不得在生产[^。\n]*seed/i);
    expect(checklist).not.toMatch(/ALLOW_(?:DEMO|PRODUCTION)_DEMO_SEED/);
    expect(checklist).toMatch(/forward-only/i);
    expect(checklist).toContain('FIRST_RELEASE_EMPTY_DB');
    expect(checklist).toMatch(/production[\s\S]*approval[\s\S]*待审批/);
    expect(index).toContain('./production-release-checklist.md');
    expect(rootReadme).toContain('./docs/production-release-checklist.md');
  });
});
