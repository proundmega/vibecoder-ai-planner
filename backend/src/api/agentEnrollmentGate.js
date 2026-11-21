/**
 * Shared gates for node enrollment/refresh. Kept separate from the removed
 * legacy fg-53 enrollment routes.
 */
function enrollmentEnabled() {
  const value = String(process.env.AGENT_ENROLLMENT_ENABLED || '').trim().toLowerCase();
  return value === '1' || value === 'true';
}

function isLoopback(ip) {
  if (!ip) return false;
  const normalized = ip.replace(/^::ffff:/, '');
  return normalized === '::1' || normalized === '127.0.0.1' || normalized.startsWith('127.');
}

function requireSecureTransport(req, res, next) {
  if (process.env.ALLOW_INSECURE_AGENT_ENROLLMENT === '1') return next();
  if (process.env.NODE_ENV === 'test' || process.env.INTEGRATION_TESTS === '1') return next();
  if (req.secure) return next();
  if (isLoopback(req.ip || req.socket?.remoteAddress)) return next();

  return res.status(403).json({
    success: false,
    error: {
      code: 'TLS_REQUIRED',
      message: 'Agent enrollment requires HTTPS (set ALLOW_INSECURE_AGENT_ENROLLMENT=1 for local testing)',
    },
  });
}

module.exports = { enrollmentEnabled, requireSecureTransport };
