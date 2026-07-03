const Docker = require('dockerode');

const DOCKER_URL = process.env.DOCKER_API_URL || 'http://docker-proxy:2375';

const isSocketPath = DOCKER_URL.startsWith('/');
const docker = isSocketPath
  ? new Docker({ socketPath: DOCKER_URL })
  : new Docker({ host: new URL(DOCKER_URL).hostname, port: parseInt(new URL(DOCKER_URL).port) || 2375 });

module.exports = { docker, DOCKER_URL };
