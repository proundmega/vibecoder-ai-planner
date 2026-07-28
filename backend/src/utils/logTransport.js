const Transport = require('winston-transport');
const https = require('https');
const http = require('http');

class LogAggregationTransport extends Transport {
  constructor(opts = {}) {
    super(opts);
    this.url = opts.url;
    this.apiKey = opts.apiKey;
    this.source = opts.source || 'vibecode-api';
    this.batchSize = opts.batchSize || 10;
    this.flushInterval = opts.flushInterval || 5000;
    this.buffer = [];
    this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
  }

  log(info, callback) {
    this.buffer.push(info);
    if (this.buffer.length >= this.batchSize) {
      this.flush();
    }
    if (callback) callback();
  }

  flush() {
    if (this.buffer.length === 0) return;

    const logs = this.buffer.splice(0, this.batchSize);
    const payload = {
      ddsource: this.source,
      ddtags: `service:vibecode-api,env:${process.env.NODE_ENV || 'development'}`,
      messages: logs.map(l => JSON.stringify(l)),
      service: 'vibecode-api',
    };

    const url = new URL(this.url);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': this.apiKey,
      },
      timeout: 5000,
    };

    const req = lib.request(options, (res) => {
      if (res.statusCode >= 400) {
        this.emit('error', new Error(`HTTP ${res.statusCode}`));
      }
    });

    req.on('error', (err) => {
      this.emit('error', err);
    });

    req.write(JSON.stringify(payload));
    req.end();
  }

  close() {
    clearInterval(this.flushTimer);
    this.flush();
  }
}

module.exports = LogAggregationTransport;
