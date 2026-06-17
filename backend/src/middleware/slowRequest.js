function slowRequestLogger(thresholdMs = 5000) {
  return (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (duration > thresholdMs) {
        console.warn(`Slow request: ${req.method} ${req.path} took ${duration}ms (threshold: ${thresholdMs}ms)`);
      }
    });
    
    next();
  };
}

module.exports = { slowRequestLogger };
