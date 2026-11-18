const express = require('express');
const request = require('supertest');
const { parseTrustProxy } = require('../utils/trustProxy');

describe('parseTrustProxy (FR14)', () => {
  it('maps common spellings to Express trust proxy values', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(parseTrustProxy('')).toBeNull();
    expect(parseTrustProxy(undefined)).toBeNull();
  });

  it('makes req.secure honor X-Forwarded-Proto with a hop count', async () => {
    const app = express();
    app.set('trust proxy', parseTrustProxy('1'));
    app.get('/', (req, res) => res.json({ secure: req.secure }));

    const trusted = await request(app).get('/').set('X-Forwarded-Proto', 'https');
    expect(trusted.body.secure).toBe(true);
  });

  it('keeps req.secure false without trust proxy', async () => {
    const app = express();
    app.get('/', (req, res) => res.json({ secure: req.secure }));

    const untrusted = await request(app).get('/').set('X-Forwarded-Proto', 'https');
    expect(untrusted.body.secure).toBe(false);
  });
});
