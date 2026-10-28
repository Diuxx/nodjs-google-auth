export class AppError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function requireCondition(condition, statusCode, code, message) {
  if (!condition) throw new AppError(statusCode, code, message);
}
