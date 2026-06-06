# BA-6: Response Handling

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Dependencies**: BA-4 (Business Logic)

---

### a) Purpose

Response handling standardizes how the API communicates results and errors to clients. It ensures consistent status codes, response shapes, and error messages across all endpoints. Good response handling improves developer experience and makes client-side error handling predictable.

### b) Actions

1. Define a standard response format:
   ```javascript
   // Success
   {
     "success": true,
     "data": { ... },
     "meta": {
       "page": 1,
       "perPage": 20,
       "total": 100
     }
   }

   // Error
   {
     "success": false,
     "error": {
       "code": "VALIDATION_ERROR",
       "message": "Title is required",
       "details": [ ... ]
     }
   }
   ```
2. Create an error handling middleware (Express "error handler"):
   ```javascript
   // middleware/errorHandler.js
   function errorHandler(err, req, res, next) {
     const statusCode = err.statusCode || 500;
     const isProduction = process.env.NODE_ENV === 'production';

     res.status(statusCode).json({
       success: false,
       error: {
         code: err.code || 'INTERNAL_ERROR',
         message: isProduction ? 'Internal server error' : err.message,
         ...(isProduction ? {} : { stack: err.stack }),
       }
     });
   }
   ```
3. Create custom error classes:
   ```javascript
   // errors/AppError.js
   class AppError extends Error {
     constructor(message, statusCode, code) {
       super(message);
       this.statusCode = statusCode;
       this.code = code;
     }
   }

   class NotFoundError extends AppError {
     constructor(message = 'Not found') {
       super(message, 404, 'NOT_FOUND');
     }
   }

   class ValidationError extends AppError {
     constructor(message, details) {
       super(message, 400, 'VALIDATION_ERROR');
       this.details = details;
     }
   }

   class ForbiddenError extends AppError {
     constructor(message = 'Forbidden') {
       super(message, 403, 'FORBIDDEN');
     }
   }
   ```
4. Apply error handler at the end of middleware chain:
   ```javascript
   app.use(errorHandler);
   ```
5. Add pagination support for list endpoints:
   ```javascript
   // Query params: ?page=1&perPage=20
   // Response includes meta with total, hasNext, hasPrev
   ```
6. Add rate limiting middleware (reuse existing `rateLimiter`):
   ```javascript
   router.use(rateLimiter);
   ```

**Current issues to fix:**
- Inconsistent response shapes: Some return `{ message }`, others return raw objects
- Error middleware may not be catching all errors — verify `app.use(errorHandler)` placement
- No pagination on list endpoints (`/api/projects`, `/api/tickets/project/:id`)
- Auth errors return `{ error: 'Unauthorized' }` instead of structured format

### c) Dependencies
- Express.js error handling (`(err, req, res, next) => {}`)
- Custom error classes
- Rate limiter (`backend/src/middleware/auth.js` — `rateLimiter`)

### d) Risks/Edge Cases
- **Stack leaks**: Logging stack traces in production — only include in development
- **Error swallowing**: `.catch(() => null)` in API client hides errors — use proper error propagation
- **Status code mismatch**: Service throws `NotFoundError` but controller returns 200 — ensure consistency
- **Large payloads**: No response size limits — add `express-limit` or configure body size limits
- **CORS**: Missing CORS headers for cross-origin requests — add `cors` middleware if needed
- **Idempotency**: PUT/DELETE should be idempotent — verify with tests

### e) Testing
- [ ] Success response: `{ success: true, data: {...}, meta: {...} }`
- [ ] Error response: `{ success: false, error: { code, message } }`
- [ ] Error handler: catches all unhandled errors, returns 500
- [ ] Custom error classes: `NotFoundError` → 404, `ValidationError` → 400, `ForbiddenError` → 403
- [ ] Pagination: list endpoints return `meta` with `page`, `perPage`, `total`
- [ ] Rate limiter: applied to routes, returns 429 when exceeded
- [ ] Production mode: stack traces excluded from error responses

---
