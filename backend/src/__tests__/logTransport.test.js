const LogAggregationTransport = require('../utils/logTransport');

describe('LogAggregationTransport', () => {
  let transport;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockReq = {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };
    mockRes = { statusCode: 200 };

    jest.spyOn(require('https'), 'request').mockImplementation(() => mockReq);
    jest.spyOn(require('http'), 'request').mockImplementation(() => mockReq);

    transport = new LogAggregationTransport({
      url: 'https://logs.example.com/v1/input',
      apiKey: 'test-api-key',
      batchSize: 2,
      flushInterval: 10000,
    });
  });

  afterEach(() => {
    transport.close();
    jest.restoreAllMocks();
  });

  it('emits logs in JSON format', () => {
    const errorSpy = jest.fn();
    transport.on('error', errorSpy);

    transport.log({ level: 'info', message: 'test message' });

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('sends to aggregation URL', () => {
    transport.log({ level: 'info', message: 'test message 1' });
    transport.log({ level: 'warn', message: 'test message 2' });

    expect(mockReq.write).toHaveBeenCalled();
    expect(mockReq.end).toHaveBeenCalled();

    const writeCall = mockReq.write.mock.calls[0][0];
    const payload = JSON.parse(writeCall);

    expect(payload.ddsource).toBe('vibecode-api');
    expect(payload.service).toBe('vibecode-api');
    expect(payload.messages).toHaveLength(2);
    expect(payload.ddtags).toContain('service:vibecode-api');
  });

  it('handles HTTP errors gracefully', () => {
    const errorSpy = jest.fn();
    transport.on('error', errorSpy);

    mockRes.statusCode = 500;

    const requestMock = jest.fn().mockImplementation((opts, callback) => {
      mockReq.on.mockImplementation((event, handler) => {});
      mockReq.write.mockImplementation(() => {});
      mockReq.end.mockImplementation(() => {
        if (callback) callback(mockRes);
      });
      return mockReq;
    });
    jest.spyOn(require('https'), 'request').mockImplementation(requestMock);

    transport.log({ level: 'info', message: 'test' });
    transport.log({ level: 'info', message: 'test' });

    expect(errorSpy).toHaveBeenCalled();
  });

  it('buffers logs until batch size or interval', () => {
    transport.log({ level: 'info', message: 'msg 1' });

    expect(mockReq.write).not.toHaveBeenCalled();

    transport.log({ level: 'info', message: 'msg 2' });

    expect(mockReq.write).toHaveBeenCalled();
  });

  it('uses custom source when provided', () => {
    transport.close();
    jest.restoreAllMocks();

    const customReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    jest.spyOn(require('https'), 'request').mockImplementation(() => customReq);

    transport = new LogAggregationTransport({
      url: 'https://logs.example.com/v1/input',
      apiKey: 'test-api-key',
      source: 'custom-service',
      batchSize: 1,
      flushInterval: 10000,
    });

    transport.log({ level: 'info', message: 'test' });

    const writeCall = customReq.write.mock.calls[0][0];
    const payload = JSON.parse(writeCall);
    expect(payload.ddsource).toBe('custom-service');
  });

  it('detects HTTPS vs HTTP protocol', () => {
    transport.close();
    jest.restoreAllMocks();

    const httpReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    jest.spyOn(require('http'), 'request').mockImplementation(() => httpReq);

    transport = new LogAggregationTransport({
      url: 'http://logs.example.com/v1/input',
      apiKey: 'test-api-key',
      batchSize: 1,
      flushInterval: 10000,
    });

    transport.log({ level: 'info', message: 'test' });

    expect(require('http').request).toHaveBeenCalled();
  });
});
