const { AppError, UtilityError, NotFoundError, ValidationError } = require('../errors/HttpError');

describe('UtilityError (BP-60)', () => {
  it('is exported from HttpError', () => {
    expect(UtilityError).toBeDefined();
    expect(typeof UtilityError).toBe('function');
  });

  it('extends AppError', () => {
    const err = new UtilityError('test');
    expect(err).toBeInstanceOf(UtilityError);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has statusCode 500 by default', () => {
    const err = new UtilityError('test');
    expect(err.statusCode).toBe(500);
  });

  it('has code UTILITY_ERROR', () => {
    const err = new UtilityError('test');
    expect(err.code).toBe('UTILITY_ERROR');
  });

  it('has isOperational = true', () => {
    const err = new UtilityError('test');
    expect(err.isOperational).toBe(true);
  });

  it('accepts custom statusCode', () => {
    const err = new UtilityError('custom', 502);
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('UTILITY_ERROR');
  });

  it('preserves message', () => {
    const err = new UtilityError('something went wrong');
    expect(err.message).toBe('something went wrong');
  });

  it('has default message "Utility error"', () => {
    const err = new UtilityError();
    expect(err.message).toBe('Utility error');
  });

  it('has stack trace via Error.captureStackTrace', () => {
    const err = new UtilityError('test');
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe('string');
  });
});
