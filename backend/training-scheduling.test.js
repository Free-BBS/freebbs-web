const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeSchedule } = require('./training-scheduling');

const course = (id, capacity) => ({ id, capacity });
const preference = (courseId, decision = null) => ({ courseId, decision });
const application = (id, ...preferences) => ({ id, preferences });

test('reserves guarantees, fills multiple seats and skips denied or inactive choices', () => {
  const courses = [course(11, 2), course(12, 1), course(13, 0)];
  const applications = [
    application(1, preference(13), preference(11, 'accept')),
    application(2, preference(11)),
    application(3, preference(12, 'deny'), preference(11)),
    application(4, preference(12)),
  ];
  assert.deepEqual(makeSchedule(courses, applications, {}), {
    assignments: [
      { applicationId: 1, courseId: 11 },
      { applicationId: 2, courseId: 11 },
      { applicationId: 4, courseId: 12 },
    ],
    unassigned: [3],
  });
});

test('asks for an exact selection from tied applicants, then considers their lower preferences', () => {
  const courses = [course(11, 1), course(12, 2), course(13, 1)];
  const applications = [
    application(1, preference(11), preference(13)),
    application(2, preference(11), preference(12)),
    application(3, preference(12)),
    application(4, preference(12)),
    application(5, preference(12), preference(13)),
  ];
  const first = makeSchedule(courses, applications, {});
  assert.deepEqual(first.conflict, {
    key: '11:1',
    courseId: 11,
    rank: 1,
    seats: 1,
    candidateIds: [1, 2],
  });
  assert.deepEqual(makeSchedule(courses, applications, { '11:1': [3] }), first);
  assert.deepEqual(makeSchedule(courses, applications, { '11:1': [2] }).conflict, {
    key: '12:1',
    courseId: 12,
    rank: 1,
    seats: 2,
    candidateIds: [3, 4, 5],
  });
  assert.deepEqual(
    makeSchedule(courses, applications, { '11:1': [2], '12:1': [3, 3] }).conflict.seats,
    2,
  );
  assert.deepEqual(makeSchedule(courses, applications, { '11:1': [2], '12:1': [3, 5] }), {
    assignments: [
      { applicationId: 2, courseId: 11 },
      { applicationId: 3, courseId: 12 },
      { applicationId: 5, courseId: 12 },
      { applicationId: 1, courseId: 13 },
    ],
    unassigned: [4],
  });
});
