# BA-3: Request Validation

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Dependencies**: None

---

### a) Purpose

Request validation ensures that incoming data meets expected formats, types, and constraints before it reaches business logic. This prevents invalid data from corrupting the database, reduces error handling in services, and provides clear error messages to API consumers.

### b) Actions

1. Choose a validation library:
   - Option A: `joi` — expressive, chainable, well-maintained
   - Option B: `zod` — TypeScript-first, but works with JS too
   - Recommendation: **joi** (consistent with existing Node.js patterns)
2. Create `validators/` directory with schema files:
   - `validators/ticketSchema.js`
   - `validators/projectSchema.js`
   - `validators/userSchema.js`
3. Define schemas for each input type:
   - `createTicketSchema` — required fields, type constraints
   - `updateTicketSchema` — all fields optional, type constraints
   - `loginSchema`, `registerSchema` — auth-specific rules
4. Create a validation middleware:
   ```javascript
   function validate(schema) {
     return (req, res, next) => {
       const { error, value } = schema.validate(req.body, { abortEarly: false });
       if (error) {
         return res.status(400).json({
           error: 'Validation failed',
           details: error.details.map(d => d.message)
         });
       }
       req.body = value;
       next();
     };
   }
   ```
5. Apply validation middleware to route handlers:
   ```javascript
   router.post('/', validate(createTicketSchema), ticketController.create);
   ```

**Example schema:**
```javascript
// validators/ticketSchema.js
const Joi = require('joi');

const createTicketSchema = Joi.object({
  projectId: Joi.string().uuid().required(),
  title: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(5000).allow('', null),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').default('medium'),
});

const updateTicketSchema = Joi.object({
  title: Joi.string().min(1).max(200).optional(),
  description: Joi.string().max(5000).allow('', null).optional(),
  status: Joi.string().valid('backlog', 'in_progress', 'review', 'done').optional(),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').optional(),
  assigneeId: Joi.string().uuid().allow(null).optional(),
});

module.exports = { createTicketSchema, updateTicketSchema };
```

### c) Dependencies
- `joi` (not yet installed — add to `package.json`)
- Schema files in `validators/`
- Controller layer to receive validated `req.body`

### d) Risks/Edge Cases
- **Schema drift**: Schemas diverge from actual API usage — test schemas alongside endpoints
- **Performance**: Validation adds overhead — benchmark with realistic payloads
- **Over-validation**: Rejecting valid edge cases (e.g., Unicode in titles) — be liberal in what you accept
- **Missing schemas**: New endpoints without validation — add lint rule to catch unvalidated routes
- **Error messages**: Joi's default messages are cryptic — customize for API consumers
- **Type coercion**: Joi coerces types by default — disable unless intentional (`{ stripUnknown: true }`)

### e) Testing
- [ ] Valid input → passes validation, `req.body` set to validated value
- [ ] Invalid input → 400 with validation details
- [ ] Missing required field → 400 with specific field error
- [ ] Extra fields → handled by `stripUnknown` option
- [ ] Type coercion → disabled or intentional
- [ ] Schema files exist for all endpoints

---
