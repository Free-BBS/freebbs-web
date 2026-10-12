function parseHomeworkArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isSubmittedHomework(item) {
  return ['submitted', 'graded'].includes(item?.status);
}

// Call only inside the transaction that has locked the current user's connector.
// Submission content/files alone are not evidence of a successful submission.
async function reconcileHomeworkCompletion(connection, userId, previous, current, verifiedAt) {
  const previousByReference = new Map(previous.map((item) => [item.sourceReference, item]));
  const submitted = [
    ...new Set(current.filter(isSubmittedHomework).map((item) => item.sourceReference)),
  ].filter((reference) => typeof reference === 'string' && reference.length <= 128 && reference);
  if (!submitted.length) return;
  const newlySubmitted = submitted.filter((reference) => {
    const old = previousByReference.get(reference);
    return old && !isSubmittedHomework(old);
  });
  if (newlySubmitted.length) {
    // An old "not done yet" toggle must not hide a later successful submission.
    // A deliberate undo made after submission remains intact on subsequent syncs.
    await connection.execute(
      `DELETE FROM campus_homework_calendar_states
       WHERE user_id = ? AND completed = 0
         AND homework_reference IN (${newlySubmitted.map(() => '?').join(', ')})`,
      [userId, ...newlySubmitted],
    );
  }
  const firstSubmissions = submitted.filter(
    (reference) => !isSubmittedHomework(previousByReference.get(reference)),
  );
  const manualOverrideGuard = firstSubmissions.length
    ? `AND (user_overridden_at IS NULL OR source_reference IN (${firstSubmissions.map(() => '?').join(', ')}))`
    : 'AND user_overridden_at IS NULL';
  await connection.execute(
    `UPDATE important_items SET status = 'completed', completed_at = COALESCE(completed_at, ?)
     WHERE user_id = ? AND source_type = 'network_classroom'
       AND source_reference IN (${submitted.map(() => '?').join(', ')})
       AND status IN ('draft', 'confirmed') AND deleted_at IS NULL
       ${manualOverrideGuard}`,
    [verifiedAt, userId, ...submitted, ...firstSubmissions],
  );
}

module.exports = { parseHomeworkArray, isSubmittedHomework, reconcileHomeworkCompletion };
