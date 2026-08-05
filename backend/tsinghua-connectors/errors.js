class CampusConnectorError extends Error {
  constructor(code, message, { status = 500, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CampusConnectorError';
    this.code = code;
    this.status = status;
  }
}

function asCampusConnectorError(error) {
  if (error instanceof CampusConnectorError) {
    return error;
  }

  return new CampusConnectorError('connector_internal_error', '校内连接器暂时不可用', {
    status: 500,
    cause: error,
  });
}

module.exports = {
  CampusConnectorError,
  asCampusConnectorError,
};
