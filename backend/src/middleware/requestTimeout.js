function requestTimeout(timeoutMs = 30000) {
  return (req, res, next) => {
    let timeoutId = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: {
            code: 'REQUEST_TIMEOUT',
            message: `Request timed out after ${timeoutMs}ms`,
          },
        });
        req.destroy();
      }
    }, timeoutMs);

    // Clear timeout when response is finished
    res.on('finish', () => {
      clearTimeout(timeoutId);
    });

    next();
  };
}

module.exports = { requestTimeout };
