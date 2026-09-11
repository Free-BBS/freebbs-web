const assert = require('node:assert/strict');
const test = require('node:test');
const {
  COMMUNITY_AGREEMENT_VERSION,
  assertCommunityAgreement,
  generateBandChallenge,
  generateWienChallenge,
  generateAuthChallenge,
  consumeRegistrationChallenge,
  consumeLoginChallenge,
} = require('./registration-guard');

test('community agreement requires the actual boolean and current version', () => {
  for (const value of [undefined, false, 1, 'true', 'on', null]) {
    assert.throws(
      () =>
        assertCommunityAgreement({
          communityAgreementAccepted: value,
          communityAgreementVersion: COMMUNITY_AGREEMENT_VERSION,
        }),
      { code: 'community_agreement_required' },
    );
  }
  for (const version of [undefined, '2026-09-08', 20260909]) {
    assert.throws(
      () =>
        assertCommunityAgreement({
          communityAgreementAccepted: true,
          communityAgreementVersion: version,
        }),
      { code: 'community_agreement_version_mismatch' },
    );
  }
  assert.doesNotThrow(() =>
    assertCommunityAgreement({
      communityAgreementAccepted: true,
      communityAgreementVersion: COMMUNITY_AGREEMENT_VERSION,
    }),
  );
});

test('oscillating bands have energy peaks and valleys with four separated positive-mass candidates', () => {
  const combinations = new Set();
  const answers = new Set();
  const answerIndices = new Set();
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const { publicChallenge, answerK, tolerance } = generateBandChallenge();
    const { carrier, objective, band } = publicChallenge;
    combinations.add(`${carrier}:${objective}`);
    answers.add(answerK.toFixed(2));
    assert.deepEqual(Object.keys(publicChallenge).sort(), ['band', 'carrier', 'objective', 'type']);
    assert.equal(publicChallenge.type, 'band');
    assert.deepEqual(Object.keys(band).sort(), ['candidates', 'kMax', 'kMin', 'points']);
    assert.equal(band.points.length, 161);
    assert.equal(band.points[0].k, band.kMin);
    assert.equal(band.points.at(-1).k, band.kMax);
    assert.equal(band.candidates.length, 4);
    assert.ok(answerK > band.kMin && answerK < band.kMax);
    answerIndices.add(band.candidates.findIndex((point) => point.k === answerK));
    assert.ok(
      band.points
        .slice(1, -1)
        .some(
          (point, index) =>
            point.energy > band.points[index].energy &&
            point.energy > band.points[index + 2].energy,
        ),
      'displayed energy must have an interior maximum',
    );
    assert.ok(
      band.points
        .slice(1, -1)
        .some(
          (point, index) =>
            point.energy < band.points[index].energy &&
            point.energy < band.points[index + 2].energy,
        ),
      'displayed energy must have an interior minimum',
    );
    const masses = band.candidates.map((candidate, candidateIndex) => {
      assert.deepEqual(Object.keys(candidate), ['k']);
      if (candidateIndex) {
        const gap = candidate.k - band.candidates[candidateIndex - 1].k;
        assert.ok(gap >= 0.2, 'markers must remain visually separate');
        assert.ok(tolerance < gap / 2);
      }
      const index = band.points.findIndex((point) => point.k === candidate.k);
      assert.ok(index > 0 && index < band.points.length - 1);
      const point = band.points[index];
      const left = band.points[index - 1];
      const right = band.points[index + 1];
      const secondDerivative =
        (right.energy - 2 * point.energy + left.energy) / (point.k - left.k) ** 2;
      const mass = (carrier === 'electron' ? 1 : -1) / secondDerivative;
      assert.ok(Number.isFinite(mass) && mass > 0);
      assert.ok(Math.abs(secondDerivative) > 1, 'candidate must not approach an inflection');
      return { k: point.k, mass };
    });
    const sorted = masses.sort((a, b) => a.mass - b.mass);
    assert.ok(sorted.at(-1).mass / sorted[0].mass > 2.5);
    assert.ok(sorted[1].mass / sorted[0].mass > 1.15, 'minimum mass must be unambiguous');
    assert.ok(sorted.at(-1).mass / sorted.at(-2).mass > 1.3, 'maximum mass must be unambiguous');
    const solved = objective === 'maximum' ? sorted.at(-1) : sorted[0];
    assert.equal(solved.k, answerK);
    assert.equal(tolerance, 0.05);
  }
  assert.equal(combinations.size, 4);
  assert.deepEqual([...answerIndices].sort(), [0, 1, 2, 3]);
  assert.ok(answers.size > 40, 'answer positions must vary materially');
});

test('Wien challenges vary components and leave a usable strict startup |Q| interval', () => {
  const wienModel = require('../public/wien-oscillator-model');
  const combinations = new Set();
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const generated = generateWienChallenge();
    const { publicChallenge, circuitParameters: p } = generated;
    assert.deepEqual(Object.keys(publicChallenge).sort(), ['oscillator', 'type']);
    assert.equal(publicChallenge.type, 'wien');
    assert.equal(publicChallenge.oscillator, p);
    assert.equal(generated.answerK, 2, 'legacy band verification must fail closed');
    assert.equal(generated.tolerance, 0);
    assert.equal(wienModel.validParameters(p), true);
    assert.equal(wienModel.evaluate(p, p.rfInitialOhms).starts, false);
    assert.equal(wienModel.evaluate(p, p.rfMaxOhms).satisfies, false);
    assert.equal(wienModel.evaluate(p, p.rgOhms * (2 + 0.5 / p.qMin)).satisfies, true);
    assert.ok(p.rgOhms / p.qMin / (p.rfMaxOhms - p.rfMinOhms) >= 0.12);
    assert.ok(p.rfMinOhms < 2 * p.rgOhms);
    assert.ok(p.rfMaxOhms > (2 + 1 / p.qMin) * p.rgOhms);
    combinations.add(JSON.stringify(p));
  }
  assert.ok(combinations.size > 40);
  const types = new Set(
    Array.from({ length: 80 }, () => generateAuthChallenge().publicChallenge.type),
  );
  assert.deepEqual([...types].sort(), ['band', 'wien']);
});

test('both authentication modes recompute Wien startup and strict |Q| from stored parameters', async () => {
  const id = 'c'.repeat(64);
  const parameters = {
    rgOhms: 10000,
    rOhms: 10000,
    cFarads: 1e-8,
    rfMinOhms: 17000,
    rfMaxOhms: 25000,
    rfInitialOhms: 17000,
    qMin: 5,
  };
  for (const [purpose, consume, prefix] of [
    ['register', consumeRegistrationChallenge, 'registration'],
    ['login', consumeLoginChallenge, 'login'],
  ]) {
    for (const [resistanceOhms, accepted] of [
      [undefined, false],
      ['21000', false],
      [null, false],
      [NaN, false],
      [Infinity, false],
      [{ value: 21000 }, false],
      [0, false],
      [17000, false],
      [19999, false],
      [20000, false],
      [20000.01, true],
      [21000, true],
      [21999.99, true],
      [22000, false],
      [22000.01, false],
      [25000, false],
      [50000, false],
    ]) {
      const record = {
        email: 'student@example.invalid',
        purpose,
        answer_k: 2,
        tolerance: 0,
        expired: 0,
        consumed_at: null,
        circuit_id: id,
        circuit_parameters: JSON.stringify(parameters),
      };
      let writes = 0;
      const connection = {
        async execute(sql) {
          if (sql.startsWith('SELECT')) return [[record]];
          record.consumed_at = new Date();
          writes += 1;
          return [{ affectedRows: 1 }];
        },
      };
      const answer = {
        challengeId: id,
        resistanceOhms,
        // These client assertions cannot change the stored task or its threshold.
        type: 'band',
        k: 2,
        q: 99999,
        gain: 3.01,
        oscillator: { ...parameters, qMin: 0.1 },
      };
      const result = await consume(connection, record.email, answer);
      assert.equal(
        result?.code ?? null,
        accepted ? null : `${prefix}_captcha_incorrect`,
        `${purpose}: ${String(resistanceOhms)}`,
      );
      assert.equal(writes, 1);
      assert.equal(
        (await consume(connection, record.email, { challengeId: id, resistanceOhms: 21000 })).code,
        `${prefix}_captcha_used`,
      );
      assert.equal(writes, 1);
    }
    for (const stored of [null, '{}', '{malformed', { ...parameters, qMin: '5' }]) {
      const connection = {
        async execute(sql) {
          if (!sql.startsWith('SELECT')) return [{ affectedRows: 1 }];
          return [
            [
              {
                email: 'student@example.invalid',
                purpose,
                answer_k: 2,
                tolerance: 0,
                expired: 0,
                consumed_at: null,
                circuit_id: id,
                circuit_parameters: stored,
              },
            ],
          ];
        },
      };
      assert.equal(
        (
          await consume(connection, 'student@example.invalid', {
            challengeId: id,
            resistanceOhms: 21000,
          })
        ).code,
        `${prefix}_captcha_incorrect`,
      );
    }
  }
});

test('login and registration accept free positions through the inclusive tolerance boundary', async () => {
  for (const [purpose, consume, prefix] of [
    ['register', consumeRegistrationChallenge, 'registration'],
    ['login', consumeLoginChallenge, 'login'],
  ]) {
    for (const answer of [-0.5, 0.5]) {
      for (const offset of [-0.2, -0.050001, -0.05, -0.04, 0, 0.04, 0.05, 0.050001, 0.2]) {
        let consumed = false;
        const connection = {
          async execute(sql) {
            if (sql.startsWith('SELECT')) {
              return [
                [
                  {
                    email: 'student@example.invalid',
                    purpose,
                    answer_k: answer,
                    tolerance: 0.05,
                    expired: 0,
                    consumed_at: null,
                  },
                ],
              ];
            }
            consumed = true;
            return [{ affectedRows: 1 }];
          },
        };
        const result = await consume(connection, 'student@example.invalid', {
          challengeId: 'b'.repeat(64),
          k: answer + offset,
        });
        const label = `${purpose}: answer ${answer}, offset ${offset}`;
        if (Math.abs(offset) <= 0.05) {
          assert.equal(result, null, label);
        } else {
          assert.equal(result.code, `${prefix}_captcha_incorrect`, label);
        }
        assert.equal(consumed, true, label);
      }
    }
  }
});

test('captcha rejects client coercion, expires, binds email, and has one attempt', async () => {
  const id = 'a'.repeat(64);
  let record;
  let writes;
  const connection = {
    async execute(sql) {
      if (sql.startsWith('SELECT')) return [[record]];
      writes += 1;
      record.consumed_at = new Date();
      return [{ affectedRows: 1 }];
    },
  };
  function reset(overrides = {}) {
    record = {
      email: 'student@example.invalid',
      purpose: 'register',
      answer_k: 0.5,
      tolerance: 0.12,
      expired: 0,
      consumed_at: null,
      ...overrides,
    };
    writes = 0;
  }
  for (const k of [undefined, '0.5', null, NaN, Infinity, {}, 1.1, -1.1, 0]) {
    reset();
    const error = await consumeRegistrationChallenge(connection, record.email, {
      challengeId: id,
      k,
    });
    assert.equal(error.code, 'registration_captcha_incorrect', String(k));
    assert.equal(writes, 1);
    const replay = await consumeRegistrationChallenge(connection, record.email, {
      challengeId: id,
      k: 0.5,
    });
    assert.equal(replay.code, 'registration_captcha_used');
    assert.equal(writes, 1);
  }
  reset({ expired: 1 });
  assert.equal(
    (await consumeRegistrationChallenge(connection, record.email, { challengeId: id, k: 0.5 }))
      .code,
    'registration_captcha_expired',
  );
  assert.equal(writes, 0);
  reset();
  assert.equal(
    (
      await consumeRegistrationChallenge(connection, 'someone-else@example.invalid', {
        challengeId: id,
        k: 0.5,
      })
    ).code,
    'registration_captcha_invalid',
  );
  assert.equal(writes, 0);
  for (const captcha of [null, {}, { challengeId: 'fabricated', k: 0.5 }]) {
    assert.equal(
      (await consumeRegistrationChallenge(connection, record.email, captcha)).code,
      'registration_captcha_required',
    );
  }
  assert.equal(
    await consumeRegistrationChallenge(connection, record.email, { challengeId: id, k: 0.5 }),
    null,
  );
  assert.equal(writes, 1);
  reset();
  assert.equal(
    (await consumeLoginChallenge(connection, record.email, { challengeId: id, k: 0.5 })).code,
    'login_captcha_invalid',
  );
  assert.equal(writes, 0);
  reset({ purpose: 'login' });
  assert.equal(
    (await consumeRegistrationChallenge(connection, record.email, { challengeId: id, k: 0.5 }))
      .code,
    'registration_captcha_invalid',
  );
  assert.equal(writes, 0);
  assert.equal(
    await consumeLoginChallenge(connection, '  STUDENT@example.invalid  ', {
      challengeId: id,
      k: 0.5,
    }),
    null,
  );
  assert.equal(writes, 1);
});
