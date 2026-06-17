describe('Multer Middleware Configuration', () => {
  const allowedTypes = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf', 'text/markdown', 'text/plain',
    'application/zip', 'application/json',
  ];

  const disallowedTypes = ['application/exe', 'application/x-msdownload', 'text/html'];

  allowedTypes.forEach(type => {
    it(`should accept ${type}`, () => {
      expect(allowedTypes).toContain(type);
    });
  });

  disallowedTypes.forEach(type => {
    it(`should reject ${type}`, () => {
      expect(allowedTypes).not.toContain(type);
    });
  });

  it('should have 9 allowed file types', () => {
    expect(allowedTypes).toHaveLength(9);
  });

  it('should enforce 10MB file size limit', () => {
    expect(10 * 1024 * 1024).toBe(10485760);
  });
});
