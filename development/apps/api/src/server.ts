import { loadEnvironment } from './config/env.js';
import { startServerRuntime } from './server-runtime.js';

const environment = loadEnvironment();
const collectionsUploadDirectory = process.env.COLLECTIONS_UPLOAD_DIR?.trim();
const runtime = await startServerRuntime({
  host: environment.host,
  port: environment.port,
  ...(collectionsUploadDirectory ? { collectionsUploadDirectory } : {}),
});

async function shutdown(): Promise<void> {
  try {
    await runtime.close();
  } catch (error) {
    console.error('Failed to shut down the API server cleanly', error);
    process.exitCode = 1;
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
