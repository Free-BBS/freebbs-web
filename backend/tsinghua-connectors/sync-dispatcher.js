const { syncTsinghuaLearn } = require('../tsinghua-learn-connector');

const AUTHORIZATION_ERRORS = new Set([
  'authorization_required',
  'connector_authorization_required',
  'connector_adapter_changed',
  'connector_credential_decrypt_failed',
  'connector_grant_invalid',
]);

function createTsinghuaSyncDispatcher({
  adapter,
  vault,
  syncStore,
  now = () => new Date(),
  runSync = syncTsinghuaLearn,
}) {
  if (!adapter || typeof adapter.createAuthorizedFetch !== 'function') {
    throw new TypeError('adapter with createAuthorizedFetch is required');
  }
  if (!vault || !syncStore) throw new TypeError('vault and syncStore are required');
  const jobs = new Set();

  async function execute(run) {
    const claimed = await syncStore.claimRun(run.public_id, now());
    if (!claimed) return;
    try {
      const adapterVersion = String(claimed.adapter_version || '1');
      const currentAdapterVersion = String(adapter.version || '1').slice(0, 32);
      if (
        String(claimed.adapter_id || '') !== String(adapter.id || '') ||
        adapterVersion !== currentAdapterVersion
      ) {
        const mismatch = new Error('connector adapter changed');
        mismatch.code = 'connector_adapter_changed';
        throw mismatch;
      }
      let opaqueGrant;
      try {
        opaqueGrant = vault.decrypt(
          {
            ciphertext: claimed.credential_ciphertext,
            iv: claimed.credential_iv,
            authTag: claimed.credential_auth_tag,
          },
          {
            userId: claimed.user_id,
            connectorId: claimed.provider,
            adapterVersion,
          },
        );
      } catch {
        const invalidCredential = new Error('connector credential could not be decrypted');
        invalidCredential.code = 'connector_credential_decrypt_failed';
        throw invalidCredential;
      }
      const authorizedFetch = adapter.createAuthorizedFetch(opaqueGrant);
      if (typeof authorizedFetch !== 'function') {
        const invalidTransport = new Error('connector transport unavailable');
        invalidTransport.code = 'connector_transport_invalid';
        throw invalidTransport;
      }
      const snapshot = await runSync({
        authorizedFetch,
        now,
        semesterId: claimed.target_semester_id || undefined,
      });
      await syncStore.completeRun(claimed, snapshot, now());
    } catch (error) {
      const code = String(error?.code || 'sync_failed').slice(0, 64);
      await syncStore.failRun(claimed, code, now(), {
        requiresAuthorization: AUTHORIZATION_ERRORS.has(code),
      });
    }
  }

  function enqueue(run) {
    const job = new Promise((resolve) => {
      setImmediate(resolve);
    })
      .then(() => execute(run))
      .finally(() => jobs.delete(job));
    jobs.add(job);
  }

  async function drain() {
    await Promise.allSettled([...jobs]);
  }

  return { drain, enqueue };
}

module.exports = { AUTHORIZATION_ERRORS, createTsinghuaSyncDispatcher };
