const Docker = require('dockerode');
const logger = require('../utils/logger');

const docker = new Docker();

class TerminalProxy {
  constructor(ws, agentId) {
    this.ws = ws;
    this.agentId = agentId;
    this.stream = null;
    this.exec = null;
  }

  async start() {
    let container;
    try {
      container = docker.getContainer(this.agentId);
    } catch (err) {
      throw new Error(`Container ${this.agentId} not found`);
    }

    let containerState;
    try {
      containerState = await container.inspect();
      if (!containerState.State.Running) {
        throw new Error('Container not running');
      }
    } catch (err) {
      throw new Error('Container not running');
    }

    try {
      this.exec = await container.exec({
        Cmd: ['/bin/bash', '-l'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
      });
    } catch (err) {
      logger.warn('bash not available, falling back to sh: %s', err.message);
      this.exec = await container.exec({
        Cmd: ['/bin/sh'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
      });
    }

    this.stream = await this.exec.start({ Tty: true, stdin: true });

    logger.info('Terminal session started for container %s', this.agentId);

    this.stream.on('data', (chunk) => {
      const raw = chunk.toString('binary');
      this.ws.send(raw);
    });

    this.stream.on('end', () => {
      this.ws.close();
    });

    this.stream.on('error', (err) => {
      logger.error('Terminal stream error: %s', err.message);
      this.ws.close();
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'input') {
          this.stream.write(Buffer.from(msg.data, 'base64'));
        } else if (msg.type === 'resize') {
          this.exec.resize({ w: msg.cols, h: msg.rows });
        }
      } catch (err) {
        logger.error('Terminal message parse error: %s', err.message);
      }
    });

    this.ws.on('close', () => this.cleanup());
    this.ws.on('error', () => this.cleanup());
  }

  cleanup() {
    if (this.stream) {
      try {
        this.stream.end();
      } catch { /* noop */ }
      this.stream = null;
    }
    this.exec = null;
  }
}

function createTerminalWSS() {
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const agentId = url.pathname.split('/').pop();
    const proxy = new TerminalProxy(ws, agentId);
    proxy.start().catch((err) => {
      logger.error('Terminal session error: %s', err.message);
      ws.close(1011, err.message);
    });
  });

  return wss;
}

module.exports = { TerminalProxy, createTerminalWSS };
