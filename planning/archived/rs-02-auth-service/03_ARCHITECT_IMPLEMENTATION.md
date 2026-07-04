# RS-2: AuthService Overhaul — Registration with Role

**Status**: completed
**Priority**: P0
**Effort**: Medium
**Author**: Lead Architect
**Date created**: 2026-06-05
**Date completed**: 2026-06-06
**PR**: feature/role-system-overhaul
**Branch**: feature/role-system-overhaul

**Dependencies**: RS-1 (Database Migration)

---

### a) Purpose

Update registration to accept a `role` parameter and track `user_created_by`. Self-registration always gets `project_admin`. Admin/member-created accounts respect the requested role (gated by creator's role).

### b) Actions

1. Update `backend/src/auth.js` — `register()` method:
   ```javascript
   async register(name, email, password, role = 'project_admin', userCreatedBy = null) {
     // Validate role based on creator's role
     if (userCreatedBy) {
       const creator = await User.find(userCreatedBy);
       if (!creator) throw new Error('Creator not found');

       if (creator.role === 'project_admin') {
         if (!['member', 'user'].includes(role)) {
           throw new Error('Project admins can only create member or user accounts');
         }
       } else if (creator.role === 'member') {
         if (role !== 'user') {
           throw new Error('Members can only create user accounts');
         }
       } else if (creator.role === 'user') {
         throw new Error('AI agents cannot create user accounts');
       }
     }

     // super_admin can only be created manually (no API path)
     if (role === 'super_admin') {
       throw new Error('Super admin accounts must be created manually');
     }

     const user = await UserService.register(name, email, password, role, userCreatedBy);
     // ... token generation (reuse existing logic)
   }
   ```
2. Update `backend/src/services/UserService.js` — `register()` method:
   ```javascript
   async register(name, email, password, role = 'project_admin', userCreatedBy = null) {
     const exists = await User.existsByEmail(email);
     if (exists) throw new Error('Email already registered');

     const hashedPassword = await bcrypt.hash(password, 10);
     const result = await pool.query(
       `INSERT INTO users (name, email, password_hash, role, user_created_by, current_plan)
        VALUES ($1, $2, $3, $4, $5, 'free')
        RETURNING *`,
       [name, email, hashedPassword, role, userCreatedBy]
     );
     return new User(result.rows[0]);
   }
   ```
3. Update `backend/src/models/user.js` — `create()` method:
   ```javascript
   static async create(name, email, password, role = 'project_admin', userCreatedBy = null) {
     const hashedPassword = await bcrypt.hash(password, 10);
     const result = await pool.query(
       'INSERT INTO users (name, email, password_hash, role, user_created_by, current_plan) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
       [name, email, hashedPassword, role, userCreatedBy, 'free']
     );
     return new User(result.rows[0]);
   }
   ```
4. Update `backend/src/api/routes.js` — register route:
   ```javascript
   router.post('/auth/register', async (req, res) => {
     const { name, email, password, role, user_created_by } = req.body;
     const result = await AuthService.register(name, email, password, role, user_created_by || null);
     res.status(201).json(result);
   });
   ```

### c) Dependencies
- RS-1 (database migration)

### d) Risks/Edge Cases
- **Role validation**: Admin can't create super_admin, member can't create member/admin, user can't create anything
- **Self-registration**: No `user_created_by` passed → defaults to `project_admin`
- **Token expiry**: Reuse existing `TOKEN_EXPIRY_MINUTES` logic from `auth.js`
- **Password hashing**: Use `bcrypt.hash(password, 10)` consistently

### e) Testing
- **Unit tests**: `backend/src/__tests__/unit.test.js` — test `AuthService.register()` role chain validation:
  - `project_admin` creates `member` → success
  - `project_admin` creates `user` → success
  - `project_admin` creates `super_admin` → throws error
  - `member` creates `user` → success
  - `member` creates `member` → throws error
  - `user` creates any account → throws error
  - `super_admin` role requested → throws error
  - Self-registration (no `user_created_by`) → defaults to `project_admin`
  - Creator not found → throws error

### f) Notes
- Default user role changed from `project_admin` to `user` in `UserService.register()`, `User` model constructor, `auth.js` register, and `routes.js` register endpoint.
- JWT secret `'vibecode-dev-secret-do-not-use-in-production'` used consistently in `UserService.authenticate()` and `getCurrentUser()`.
