const { AppError, UtilityError, DataIntegrityError } = require('../errors/HttpError');

describe('DataIntegrityError', () => {
  it('is an operational 500 with a data-integrity code', () => {
    const err = new DataIntegrityError('bad row');

    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('DATA_INTEGRITY_ERROR');
    expect(err.isOperational).toBe(true);
    expect(err.message).toBe('bad row');
  });
});

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
