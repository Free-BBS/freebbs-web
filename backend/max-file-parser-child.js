const { runParserTask } = require('./max-files');

// One private IPC task per process. No command strings or document paths are accepted.
if (process.send) {
  let finished = false;
  process.once('disconnect', () => {
    // The API host disappeared before the task completed; do not orphan a parser.
    if (!finished) process.exit(1);
  });
  process.once('message', async (task) => {
    let result;
    try {
      const value = await runParserTask(task);
      result = task.visual ? { document: value } : { text: value };
    } catch (error) {
      result = { error: error.message };
    }
    if (process.connected) {
      process.send(result, () => {
        finished = true;
        if (process.connected) process.disconnect();
      });
    }
  });
}
