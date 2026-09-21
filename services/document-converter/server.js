const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
let active = false;
http
  .createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.end('ok');
      return;
    }
    const ext = request.headers['x-document-extension'];
    if (
      request.method !== 'POST' ||
      request.url !== '/convert' ||
      !['.ppt', '.pptx'].includes(ext)
    ) {
      response.writeHead(400).end('Invalid document');
      return;
    }
    if (active) {
      response.writeHead(429).end('Converter busy');
      return;
    }
    active = true;
    let directory;
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 100 * 1024 * 1024) throw new Error('File exceeds 100 MB');
        chunks.push(chunk);
      }
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'max-slides-'));
      const profile = path.join(directory, 'profile');
      await fs.mkdir(path.join(profile, 'user'), { recursive: true });
      await fs.writeFile(
        path.join(profile, 'user', 'registrymodifications.xcu'),
        '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateMode" oor:op="fuse"><value>0</value></prop></item></oor:items>',
      );
      const input = path.join(directory, `slides${ext}`);
      await fs.writeFile(input, Buffer.concat(chunks));
      await promisify(execFile)(
        '/usr/bin/libreoffice',
        [
          '--headless',
          '--nologo',
          '--nodefault',
          '--norestore',
          `-env:UserInstallation=${pathToFileURL(profile).href}`,
          '--convert-to',
          'pdf:impress_pdf_Export',
          '--outdir',
          directory,
          input,
        ],
        { timeout: 35000, maxBuffer: 1024 * 1024 },
      );
      const output = path.join(directory, 'slides.pdf');
      if ((await fs.stat(output)).size > 100 * 1024 * 1024)
        throw new Error('Rendered PDF exceeds 100 MB');
      response.writeHead(200, { 'Content-Type': 'application/pdf' });
      response.end(await fs.readFile(output));
    } catch {
      if (!response.headersSent) response.writeHead(422);
      response.end('Presentation conversion failed; export to PDF and retry.');
    } finally {
      if (directory) await fs.rm(directory, { recursive: true, force: true });
      active = false;
    }
  })
  .listen(8080, '0.0.0.0');
