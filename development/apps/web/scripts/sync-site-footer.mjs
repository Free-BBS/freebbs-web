import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const source = fileURLToPath(new URL('../../../../public/site-footer.css', import.meta.url));
const destination = fileURLToPath(new URL('../src/styles/shared-site-footer.css', import.meta.url));

function syncSiteFooter() {
  let css;
  try {
    css = readFileSync(source);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Development-only Docker builds retain the checked-in snapshot.
    if (existsSync(destination)) return;
    throw new Error(`Footer CSS is missing: neither ${source} nor ${destination} exists.`);
  }

  if (existsSync(destination) && readFileSync(destination).equals(css)) return;
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, css);
}

syncSiteFooter();
