import { pathToFileURL } from 'node:url';
import process from 'node:process';

const [source, directory, mode] = process.argv.slice(2);
const { featureStorage } = await import(pathToFileURL(source).href);
await featureStorage(directory, 'test-records').change('record', async (record) => {
  if (mode === 'crash') process.exit(17);
  if (mode === 'hold') {
    process.stdout.write('locked\n');
    await new Promise((done) => process.stdin.once('data', done));
  }
  return { record: { id: 'record', count: (record?.count ?? 0) + 1 }, result: null };
});
