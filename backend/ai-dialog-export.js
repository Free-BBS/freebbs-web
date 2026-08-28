function decodeMessages(messagesJson) {
  const rawMessages = String(messagesJson || '[]');

  try {
    const messages = JSON.parse(rawMessages);

    if (!Array.isArray(messages)) {
      throw new TypeError('AI dialog messages must be an array');
    }

    return {
      messages,
      messageCount: messages.length,
      invalid: false,
    };
  } catch {
    return {
      messages: null,
      messagesRaw: rawMessages,
      messagesError: 'invalid_json',
      messageCount: 0,
      invalid: true,
    };
  }
}

function toExportedDialog(row) {
  const decoded = decodeMessages(row.messages_json);
  const dialog = {
    id: Number(row.id),
    did: row.did,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: decoded.messages,
  };

  if (decoded.invalid) {
    dialog.messagesRaw = decoded.messagesRaw;
    dialog.messagesError = decoded.messagesError;
  }

  return {
    dialog,
    invalid: decoded.invalid,
    messageCount: decoded.messageCount,
  };
}

function buildAiDialogExport({ users, dialogs, exportedBy, exportedAt = new Date() }) {
  const usersById = new Map();
  const exportedUsers = users.map((user) => {
    const exportedUser = {
      id: Number(user.id),
      uid: user.uid || '',
      username: user.username,
      fullName: user.full_name,
      studentId: user.student_id,
      role: user.role,
      dialogs: [],
    };
    usersById.set(String(user.id), exportedUser);
    return exportedUser;
  });
  let messageCount = 0;
  let invalidDialogCount = 0;

  dialogs.forEach((row) => {
    const exportedUser = usersById.get(String(row.user_id));

    if (!exportedUser) {
      return;
    }

    const exportedDialog = toExportedDialog(row);
    exportedUser.dialogs.push(exportedDialog.dialog);
    messageCount += exportedDialog.messageCount;
    invalidDialogCount += exportedDialog.invalid ? 1 : 0;
  });

  return {
    schemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    exportedBy: {
      id: Number(exportedBy.id),
      uid: exportedBy.uid || '',
      username: exportedBy.username,
    },
    totals: {
      users: exportedUsers.length,
      usersWithDialogs: exportedUsers.filter((user) => user.dialogs.length > 0).length,
      dialogs: dialogs.length,
      messages: messageCount,
      invalidDialogs: invalidDialogCount,
    },
    users: exportedUsers,
  };
}

function buildAiDialogExportFileName(exportedAt = new Date()) {
  const timestamp = exportedAt.toISOString().replace(/[:.]/g, '-');
  return `free-bbs-ai-chats-${timestamp}.json`;
}

module.exports = {
  buildAiDialogExport,
  buildAiDialogExportFileName,
  decodeMessages,
};
