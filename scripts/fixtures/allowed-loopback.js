// Test fixtures only: OS-assigned ports may be blocked by WHATWG Fetch/Undici.
// Select a usable localhost port before any business request or assertion runs.
const blockedPorts = Object.freeze([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);
const blocked = new Set(blockedPorts);
const isBlockedPort = (port) => blocked.has(Number(port));

function selectionMessage({ port, attemptedPorts, skippedPorts }) {
  return `allowed-loopback selected=${port ?? 'none'} attempted=[${attemptedPorts.join(',')}] skipped=[${skippedPorts.join(',')}]`;
}

function bind(server) {
  return new Promise((resolve, reject) => {
    const cleanup = () => server.removeListener('error', fail);
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    server.once('error', fail);
    try {
      server.listen(0, '127.0.0.1', () => {
        cleanup();
        resolve(server.address());
      });
    } catch (error) {
      fail(error);
    }
  });
}
const close = (server) =>
  new Promise((resolve, reject) => {
    try {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      reject(error);
    }
  });

async function listenAllowedLoopback(server, { maxAttempts = 8, diagnostic } = {}) {
  if (
    !server ||
    ['listen', 'address', 'close', 'once', 'removeListener'].some(
      (name) => typeof server[name] !== 'function',
    )
  )
    throw new TypeError('An unbound local test server is required');
  if (server.listening)
    throw new TypeError('Refusing to rebind or close an already listening server');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 32)
    throw new TypeError('maxAttempts must be an integer from 1 through 32');
  if (diagnostic !== undefined && typeof diagnostic !== 'function')
    throw new TypeError('diagnostic must be a function');
  const selection = { port: null, attemptedPorts: [], skippedPorts: [] };
  let ownedBound = false;
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const address = await bind(server);
      ownedBound = true;
      const port = address?.port;
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('Local test server returned an invalid numeric port');
      selection.attemptedPorts.push(port);
      if (!isBlockedPort(port)) {
        selection.port = port;
        const result = Object.freeze({
          port,
          attemptedPorts: Object.freeze([...selection.attemptedPorts]),
          skippedPorts: Object.freeze([...selection.skippedPorts]),
        });
        diagnostic?.(selectionMessage(result));
        return result;
      }
      selection.skippedPorts.push(port);
      // Never relisten before the excluded listener has actually closed.
      ownedBound = false;
      await close(server);
    }
    throw new Error(`No Fetch-allowed loopback port after ${maxAttempts} selections`);
  } catch (error) {
    if (ownedBound) {
      try {
        await close(server);
      } catch (cleanupError) {
        error.cleanupError = cleanupError;
      }
    }
    error.portSelection = {
      port: selection.port,
      attemptedPorts: [...selection.attemptedPorts],
      skippedPorts: [...selection.skippedPorts],
    };
    error.message = `${error.message}; ${selectionMessage(selection)}`;
    throw error;
  }
}

module.exports = { blockedPorts, isBlockedPort, listenAllowedLoopback, selectionMessage };
