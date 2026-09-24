export class RecordConflictError extends Error {
  override readonly name = 'RecordConflictError';

  constructor(message = 'Record already exists', options?: ErrorOptions) {
    super(message, options);
  }
}
