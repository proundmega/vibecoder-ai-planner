function apiVersion(version = 'v1') {
  return (req, res, next) => {
    req.apiVersion = version;
    
    // Add deprecation header if not latest
    if (version !== 'v1') {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', '2026-12-31');
    }
    
    next();
  };
}

module.exports = { apiVersion };
