const GenericProvider = require('../providers/generic');
jest.mock('axios');
const axios = require('axios');

describe('GenericProvider SSRF Protection', () => {
  describe('constructor', () => {
    it('should throw on localhost', () => {
      expect(() => new GenericProvider({ baseUrl: 'http://localhost:8080' })).toThrow(
        'Base URL must not point to a private or internal host'
      );
    });

    it('should throw on 127.0.0.1', () => {
      expect(() => new GenericProvider({ baseUrl: 'http://127.0.0.1:8080' })).toThrow(
        'Base URL must not point to a private or internal host'
      );
    });

    it('should throw on 10.x.x.x', () => {
      expect(() => new GenericProvider({ baseUrl: 'http://10.0.0.1:8080' })).toThrow(
        'Base URL must not point to a private or internal host'
      );
    });

    it('should throw on 172.16-31.x.x', () => {
      expect(() => new GenericProvider({ baseUrl: 'http://172.16.0.1:8080' })).toThrow(
        'Base URL must not point to a private or internal host'
      );
      expect(() => new GenericProvider({ baseUrl: 'http://172.31.255.1:8080' })).toThrow(
        'Base URL must not point to a private or internal host'
      );
    });

    it('should throw on 192.168.x.x', () => {
      expect(() => new GenericProvider({ baseUrl: 'http://192.168.1.1:8080' })).toThrow(
        'Base URL must not point to a private or internal host'
      );
    });

    it('should throw on .local domains', () => {
      expect(() => new GenericProvider({ baseUrl: 'http://api.local:8080' })).toThrow(
        'Base URL must not point to a private or internal host'
      );
    });

    it('should throw on metadata.google.internal', () => {
      expect(() => new GenericProvider({ baseUrl: 'http://metadata.google.internal' })).toThrow(
        'Base URL must not point to a private or internal host'
      );
    });

    it('should allow public HTTPS URLs', () => {
      const provider = new GenericProvider({
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      });
      expect(provider.baseURL).toBe('https://api.openai.com');
    });

    it('should allow public HTTP URLs', () => {
      const provider = new GenericProvider({
        baseUrl: 'http://api.example.com',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      });
      expect(provider.baseURL).toBe('http://api.example.com');
    });

    it('should allow null baseUrl', () => {
      const provider = new GenericProvider({ apiKey: 'sk-test' });
      expect(provider.baseURL).toBeUndefined();
    });
  });

  describe('chat()', () => {
    beforeEach(() => {
      axios.post.mockRejectedValue(new Error('Network error'));
    });

    it('should throw SSRF error when baseUrl points to private host (defense-in-depth)', async () => {
      const provider = new GenericProvider({
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      });
      Object.defineProperty(provider, 'baseURL', { value: 'http://169.254.169.254/latest/meta-data/' });
      await expect(provider.chat([{ role: 'user', content: 'test' }])).rejects.toThrow(
        'Base URL must not point to a private or internal host'
      );
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should throw SSRF error for .internal domains (defense-in-depth)', async () => {
      const provider = new GenericProvider({
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      });
      Object.defineProperty(provider, 'baseURL', { value: 'http://docker.internal:8080' });
      await expect(provider.chat([{ role: 'user', content: 'test' }])).rejects.toThrow(
        'Base URL must not point to a private or internal host'
      );
      expect(axios.post).not.toHaveBeenCalled();
    });
  });
});
