const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildAiDialogExport,
  buildAiDialogExportFileName,
  decodeMessages,
} = require('./ai-dialog-export');

test('builds a complete AI dialog export grouped by every user', () => {
  const exportedAt = new Date('2026-08-29T08:09:10.123Z');
  const payload = buildAiDialogExport({
    exportedAt,
    exportedBy: { id: 1, uid: 'u_admin', username: 'admin' },
    users: [
      {
        id: 1,
        uid: 'u_admin',
        username: 'admin',
        full_name: 'Administrator',
        student_id: '2099999998',
        role: 'admin',
      },
      {
        id: 2,
        uid: 'u_student',
        username: 'student',
        full_name: 'Student',
        student_id: '2026000001',
        role: 'student',
      },
    ],
    dialogs: [
      {
        id: 11,
        user_id: 2,
        did: 'dialog-1',
        title: '复习计划',
        messages_json: JSON.stringify([
          { role: 'user', content: '帮我复习' },
          { role: 'assistant', content: '可以' },
        ]),
        created_at: '2026-08-28T01:00:00.000Z',
        updated_at: '2026-08-28T02:00:00.000Z',
      },
    ],
  });

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.exportedAt, exportedAt.toISOString());
  assert.deepEqual(payload.exportedBy, { id: 1, uid: 'u_admin', username: 'admin' });
  assert.deepEqual(payload.totals, {
    users: 2,
    usersWithDialogs: 1,
    dialogs: 1,
    messages: 2,
    invalidDialogs: 0,
  });
  assert.equal(payload.users[0].dialogs.length, 0);
  assert.equal(payload.users[1].dialogs[0].did, 'dialog-1');
  assert.equal(payload.users[1].dialogs[0].messages.length, 2);
});

test('preserves malformed dialog data instead of dropping it from the export', () => {
  const decoded = decodeMessages('{not-json');

  assert.equal(decoded.invalid, true);
  assert.equal(decoded.messages, null);
  assert.equal(decoded.messagesRaw, '{not-json');
  assert.equal(decoded.messagesError, 'invalid_json');
});

test('generates an attachment-safe timestamped JSON filename', () => {
  assert.equal(
    buildAiDialogExportFileName(new Date('2026-08-29T08:09:10.123Z')),
    'free-bbs-ai-chats-2026-08-29T08-09-10-123Z.json',
  );
});
