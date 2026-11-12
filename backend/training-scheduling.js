function makeSchedule(courses, applications, choices) {
  const available = new Map(courses.map(({ id, capacity }) => [id, capacity]));
  const assignments = [];
  const placed = new Set();
  const remaining = applications.filter(({ preferences }) => preferences.length);
  const ranks = remaining.reduce(
    (maximum, { preferences }) => Math.max(maximum, preferences.length),
    0,
  );

  function assign(applicationId, courseId) {
    assignments.push({ applicationId, courseId });
    placed.add(applicationId);
    available.set(courseId, available.get(courseId) - 1);
  }

  // Guarantees reserve seats before considering ranked preferences.
  remaining.forEach(({ id, preferences }) => {
    const guaranteed = preferences.find(
      ({ courseId, decision }) => decision === 'accept' && available.get(courseId) > 0,
    );
    if (guaranteed) assign(id, guaranteed.courseId);
  });

  for (let index = 0; index < ranks; index += 1) {
    const contenders = new Map();
    remaining.forEach(({ id, preferences }) => {
      if (placed.has(id)) return;
      const preference = preferences[index];
      if (
        !preference ||
        preference.decision === 'deny' ||
        !(available.get(preference.courseId) > 0)
      ) {
        return;
      }
      const { courseId } = preference;
      if (!contenders.has(courseId)) contenders.set(courseId, []);
      contenders.get(courseId).push(id);
    });

    for (const [courseId, candidateIds] of contenders) {
      const seats = available.get(courseId);
      if (candidateIds.length <= seats) {
        candidateIds.forEach((id) => assign(id, courseId));
        continue;
      }
      const rank = index + 1;
      const key = `${courseId}:${rank}`;
      const selected = choices[key];
      if (
        !Array.isArray(selected) ||
        selected.length !== seats ||
        new Set(selected).size !== seats ||
        selected.some((id) => !candidateIds.includes(id))
      ) {
        return { conflict: { key, courseId, rank, seats, candidateIds } };
      }
      selected.forEach((id) => assign(id, courseId));
    }
  }

  return {
    assignments,
    unassigned: applications.filter(({ id }) => !placed.has(id)).map(({ id }) => id),
  };
}

module.exports = { makeSchedule };
