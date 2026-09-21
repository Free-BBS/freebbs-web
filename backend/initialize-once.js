// Share startup work across requests; a failed attempt may be retried.
module.exports = function initializeOnce(initialize) {
  let pending;
  return function ready() {
    if (!pending)
      pending = Promise.resolve()
        .then(initialize)
        .catch((error) => {
          pending = undefined;
          throw error;
        });
    return pending;
  };
};
