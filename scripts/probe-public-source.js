#!/usr/bin/env node

const { probePublicNoticeSource } = require('../backend/public-source-probe');
const { probePrimaryTsinghuaPortals } = require('../backend/portal-boundary-probe');
const { getTsinghuaConnectorCapabilities } = require('../backend/tsinghua-learn-connector');

async function main() {
  const [publicSource, portals] = await Promise.all([
    probePublicNoticeSource({ useCache: false }),
    probePrimaryTsinghuaPortals({ useCache: false }),
  ]);
  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        connectorCapabilities: getTsinghuaConnectorCapabilities(),
        publicSource,
        portals,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      code: error.code || 'probe_failed',
      message: error.message || '公开源验证失败',
    })}\n`,
  );
  process.exitCode = 1;
});
