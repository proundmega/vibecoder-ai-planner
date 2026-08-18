const { validate, validatePathParams } = require('../middleware/validate');
const Joi = require('joi');
const { paginationSchema } = require('../validators/pagination');
const { statusFilterSchema } = require('../validators/statusFilter');
const { jsonContentTypeSchema } = require('../validators/contentType');
const { pathParams } = require('../validators/pathParams');

describe('validate middleware', () => {
  describe('body validation (existing behavior)', () => {
    it('should pass valid body', () => {
      const schema = { body: Joi.object({ name: Joi.string().required() }) };
      const middleware = validate(schema);
      const req = { body: { name: 'test' }, query: {}, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body.name).toBe('test');
    });

    it('should reject missing required field', () => {
      const schema = { body: Joi.object({ name: Joi.string().required() }) };
      const middleware = validate(schema);
      const req = { body: {}, query: {}, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
      }));
      expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.json.mock.calls[0][0].error.details)).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });

    it('should pass body validation with no schema.body', () => {
      const middleware = validate({});
      const req = { body: {}, query: {}, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('query validation (Q1)', () => {
    it('should accept valid pagination params', () => {
      const middleware = validate({ query: paginationSchema });
      const req = { body: {}, query: { page: '2', limit: '50' }, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.query.page).toBe(2);
      expect(req.query.limit).toBe(50);
    });

    it('should apply defaults for missing pagination params', () => {
      const middleware = validate({ query: paginationSchema });
      const req = { body: {}, query: {}, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.query.page).toBe(1);
      expect(req.query.limit).toBe(20);
    });

    it('should reject non-integer page', () => {
      const middleware = validate({ query: paginationSchema });
      const req = { body: {}, query: { page: 'abc' }, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
      }));
      expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.json.mock.calls[0][0].error.details)).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject negative limit', () => {
      const middleware = validate({ query: paginationSchema });
      const req = { body: {}, query: { limit: '-1' }, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
      }));
      expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.json.mock.calls[0][0].error.details)).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject limit exceeding max', () => {
      const middleware = validate({ query: paginationSchema });
      const req = { body: {}, query: { limit: '200' }, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
      }));
      expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.json.mock.calls[0][0].error.details)).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });

    it('should accept valid status filter', () => {
      const middleware = validate({ query: statusFilterSchema });
      const req = { body: {}, query: { status: 'in_progress', priority: 'high' }, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.query.status).toBe('in_progress');
      expect(req.query.priority).toBe('high');
    });

    it('should reject invalid status value', () => {
      const middleware = validate({ query: statusFilterSchema });
      const req = { body: {}, query: { status: 'invalid_status' }, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
      }));
      expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.json.mock.calls[0][0].error.details)).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject NaN page value', () => {
      const middleware = validate({ query: paginationSchema });
      const req = { body: {}, query: { page: 'NaN' }, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
      }));
      expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.json.mock.calls[0][0].error.details)).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('header validation (Q3)', () => {
    it('should accept valid Content-Type header', () => {
      const middleware = validate({ headers: jsonContentTypeSchema, body: Joi.object({ name: Joi.string() }) });
      const req = { body: { name: 'test' }, query: {}, params: {}, headers: { 'content-type': 'application/json' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should reject missing Content-Type on POST', () => {
      const middleware = validate({ headers: jsonContentTypeSchema, body: Joi.object({ name: Joi.string() }) });
      const req = { body: { name: 'test' }, query: {}, params: {}, headers: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
      }));
      expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.json.mock.calls[0][0].error.details)).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject wrong Content-Type', () => {
      const middleware = validate({ headers: jsonContentTypeSchema, body: Joi.object({ name: Joi.string() }) });
      const req = { body: { name: 'test' }, query: {}, params: {}, headers: { 'content-type': 'text/plain' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
      }));
      expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.json.mock.calls[0][0].error.details)).toBe(true);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('combined query + body validation', () => {
    it('should validate both query and body when both are valid', () => {
      const middleware = validate({
        query: paginationSchema,
        body: Joi.object({ name: Joi.string() }),
      });
      const req = { body: { name: 'test' }, query: { page: '1', limit: '10' }, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.query.page).toBe(1);
      expect(req.query.limit).toBe(10);
      expect(req.body.name).toBe('test');
    });

    it('should validate query first before body', () => {
      const middleware = validate({
        query: paginationSchema,
        body: Joi.object({ name: Joi.string().required() }),
      });
      const req = { body: { name: 'test' }, query: { page: 'abc' }, params: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('combined header + body validation', () => {
    it('should validate headers first before body', () => {
      const middleware = validate({
        headers: jsonContentTypeSchema,
        body: Joi.object({ name: Joi.string().required() }),
      });
      const req = { body: { name: 'test' }, query: {}, params: {}, headers: { 'content-type': 'text/plain' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });
  });
});

describe('validatePathParams middleware (Q2)', () => {
  it('should accept valid integer path params', () => {
    const middleware = validatePathParams({ id: pathParams.id });
    const req = { params: { id: '42' }, query: {}, body: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should reject non-numeric path param', () => {
    const middleware = validatePathParams({ id: pathParams.id });
    const req = { params: { id: 'abc' }, query: {}, body: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
    }));
    expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.json.mock.calls[0][0].error.details)).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject zero as path param', () => {
    const middleware = validatePathParams({ id: pathParams.id });
    const req = { params: { id: '0' }, query: {}, body: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
    }));
    expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.json.mock.calls[0][0].error.details)).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject negative path param', () => {
    const middleware = validatePathParams({ id: pathParams.id });
    const req = { params: { id: '-5' }, query: {}, body: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
    }));
    expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.json.mock.calls[0][0].error.details)).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('should validate multiple path params', () => {
    const middleware = validatePathParams({
      ticketId: pathParams.ticketId,
      projectId: pathParams.projectId,
    });
    const req = { params: { ticketId: '1', projectId: '42' }, query: {}, body: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should reject when any path param is invalid', () => {
    const middleware = validatePathParams({
      ticketId: pathParams.ticketId,
      projectId: pathParams.projectId,
    });
    const req = { params: { ticketId: 'abc', projectId: '42' }, query: {}, body: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
    }));
    expect(res.json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.json.mock.calls[0][0].error.details)).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('should handle empty params object (no validation)', () => {
    const middleware = validatePathParams({});
    const req = { params: { id: 'abc' }, query: {}, body: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
