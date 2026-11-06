import 'cypress-localstorage-commands';

interface SeedUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
}

interface SeedResult {
  users: {
    admin: SeedUser;
    member: SeedUser;
    agent: SeedUser;
  };
  tokens: Record<'admin' | 'member' | 'agent', string>;
  projectId: string;
  projectName: string;
  backlogTicketId: string;
  inProgressTicketId: string;
}

const PASSWORD = 'password123';

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function setSession(user: SeedUser, token: string) {
  return cy
    .request({
      method: 'GET',
      url: `/api/v1/permissions/${user.role}`,
      headers: authHeaders(token),
    })
    .then((resp) => {
      cy.setLocalStorage('vibecode_token', token);
      cy.setLocalStorage('vibecode_user', JSON.stringify(user));
      cy.setLocalStorage('vibecode_permissions', JSON.stringify(resp.body.data || []));
    });
}

Cypress.Commands.add('login', (email: string, password: string) => {
  return cy
    .request({
      method: 'POST',
      url: '/api/auth/login',
      body: { email, password },
      failOnStatusCode: false,
    })
    .then((resp) => {
      if (resp.status !== 200) {
        throw new Error(`Login failed for ${email}: ${JSON.stringify(resp.body)}`);
      }
      const { token, user } = resp.body;
      return setSession(user, token);
    });
});

Cypress.Commands.add('logout', () => {
  cy.clearLocalStorage();
});

Cypress.Commands.add('register', (name: string, email: string, password: string, role = 'member') => {
  return cy
    .request({
      method: 'POST',
      url: '/api/auth/register',
      body: { name, email, password, role },
      failOnStatusCode: false,
    })
    .then((resp) => {
      if (resp.status !== 201) {
        throw new Error(`Registration failed for ${email}: ${JSON.stringify(resp.body)}`);
      }
      return setSession(resp.body.user, resp.body.token).then(() => resp.body.user);
    });
});

Cypress.Commands.add('createProject', (name: string, description = 'Created by Cypress') => {
  return cy.getLocalStorage('vibecode_token').then((token) =>
    cy
      .request({
        method: 'POST',
        url: '/api/v1/projects',
        headers: authHeaders(token as string),
        body: { name, description },
        failOnStatusCode: false,
      })
      .then((resp) => {
        if (resp.status !== 201) {
          throw new Error(`Failed to create project: ${JSON.stringify(resp.body)}`);
        }
        return resp.body.data.id as string;
      })
  );
});

Cypress.Commands.add('createTicket', (projectId: string, title: string, description = 'Created by Cypress') => {
  return cy.getLocalStorage('vibecode_token').then((token) =>
    cy
      .request({
        method: 'POST',
        url: '/api/v1/tickets',
        headers: authHeaders(token as string),
        body: { projectId, title, description },
        failOnStatusCode: false,
      })
      .then((resp) => {
        if (resp.status !== 201) {
          throw new Error(`Failed to create ticket: ${JSON.stringify(resp.body)}`);
        }
        return resp.body.data.id as string;
      })
  );
});

Cypress.Commands.add('createUser', (name: string, email: string, role = 'member') => {
  return cy.getLocalStorage('vibecode_token').then((token) =>
    cy
      .request({
        method: 'POST',
        url: '/api/v1/users',
        headers: authHeaders(token as string),
        body: { name, email, password: PASSWORD, role },
        failOnStatusCode: false,
      })
      .then((resp) => {
        if (resp.status !== 201) {
          throw new Error(`Failed to create user: ${JSON.stringify(resp.body)}`);
        }
        return resp.body.data;
      })
  );
});

Cypress.Commands.add('seed', () => {
  const timestamp = Date.now();
  const users = {
    admin: {
      name: `E2E Admin ${timestamp}`,
      email: `e2e-admin-${timestamp}@example.com`,
      password: PASSWORD,
      role: 'project_admin',
    },
    member: {
      name: `E2E Member ${timestamp}`,
      email: `e2e-member-${timestamp}@example.com`,
      password: PASSWORD,
      role: 'member',
    },
    agent: {
      name: `E2E Agent ${timestamp}`,
      email: `e2e-agent-${timestamp}@example.com`,
      password: PASSWORD,
      role: 'user',
    },
  };

  const tokens: Record<string, string> = {};
  const usersById: Record<string, SeedUser> = {};

  const registerAdmin = () => {
    const user = users.admin;
    return cy
      .request({
        method: 'POST',
        url: '/api/auth/register',
        body: user,
        failOnStatusCode: false,
      })
      .then((resp) => {
        if (resp.status !== 201) {
          throw new Error(`Seed registration failed for ${user.email}: ${JSON.stringify(resp.body)}`);
        }
        tokens.admin = resp.body.token;
        usersById.admin = { ...user, id: resp.body.user.id };
      });
  };

  // super_admin cannot self-register, so the admin creates the other roles.
  const createManaged = (key: 'member' | 'agent') => {
    const user = users[key];
    return cy
      .request({
        method: 'POST',
        url: '/api/v1/users',
        headers: authHeaders(tokens.admin),
        body: user,
        failOnStatusCode: false,
      })
      .then((resp) => {
        if (resp.status !== 201) {
          throw new Error(`Seed user creation failed for ${user.email}: ${JSON.stringify(resp.body)}`);
        }
        usersById[key] = { ...user, id: resp.body.data.id };
        return cy.request({
          method: 'POST',
          url: '/api/auth/login',
          body: { email: user.email, password: user.password },
          failOnStatusCode: false,
        });
      })
      .then((resp) => {
        if (resp.status !== 200) {
          throw new Error(`Seed login failed for ${user.email}: ${JSON.stringify(resp.body)}`);
        }
        tokens[key] = resp.body.token;
      });
  };

  return registerAdmin()
    .then(() => createManaged('member'))
    .then(() => createManaged('agent'))
    .then(() => {
      const projectName = `E2E Project ${timestamp}`;
      return cy
        .request({
          method: 'POST',
          url: '/api/v1/projects',
          headers: authHeaders(tokens.admin),
          body: { name: projectName, description: 'Seeded by Cypress' },
          failOnStatusCode: false,
        })
        .then((resp) => {
          if (resp.status !== 201) {
            throw new Error(`Seed project failed: ${JSON.stringify(resp.body)}`);
          }
          return { projectId: resp.body.data.id as string, projectName };
        });
    })
    .then(({ projectId, projectName }) => {
      return cy
        .request({
          method: 'POST',
          url: '/api/v1/tickets',
          headers: authHeaders(tokens.admin),
          body: { projectId, title: `Seeded backlog ${timestamp}`, description: 'Seeded by Cypress' },
          failOnStatusCode: false,
        })
        .then((backlogResp) => {
          if (backlogResp.status !== 201) {
            throw new Error(`Seed backlog ticket failed: ${JSON.stringify(backlogResp.body)}`);
          }
          const backlogTicketId = backlogResp.body.data.id as string;
          return cy
            .request({
              method: 'POST',
              url: '/api/v1/tickets',
              headers: authHeaders(tokens.admin),
              body: { projectId, title: `Seeded in progress ${timestamp}`, description: 'Seeded by Cypress' },
              failOnStatusCode: false,
            })
            .then((progressResp) => {
              if (progressResp.status !== 201) {
                throw new Error(`Seed progress ticket failed: ${JSON.stringify(progressResp.body)}`);
              }
              const inProgressTicketId = progressResp.body.data.id as string;
              return cy
                .request({
                  method: 'PUT',
                  url: `/api/v1/tickets/${inProgressTicketId}`,
                  headers: authHeaders(tokens.admin),
                  body: { status: 'in_progress' },
                  failOnStatusCode: false,
                })
                .then((transition) => {
                  if (transition.status !== 200) {
                    throw new Error(`Seed status transition failed: ${JSON.stringify(transition.body)}`);
                  }
                  const result: SeedResult = {
                    users: usersById as SeedResult['users'],
                    tokens: tokens as SeedResult['tokens'],
                    projectId,
                    projectName,
                    backlogTicketId,
                    inProgressTicketId,
                  };
                  return result;
                });
            });
        });
    });
});

Cypress.Commands.add('assertStatusBadge', (status: string) => {
  cy.get('.badge.status').should('contain', status);
});

Cypress.Commands.add('assertRoleBadge', (role: string) => {
  cy.get('[data-testid="role-badge"]').should('contain', role);
});

declare global {
  namespace Cypress {
    interface Chainable {
      login(email: string, password: string): Chainable<void>;
      logout(): Chainable<void>;
      register(name: string, email: string, password: string, role?: string): Chainable<SeedUser>;
      createProject(name: string, description?: string): Chainable<string>;
      createTicket(projectId: string, title: string, description?: string): Chainable<string>;
      createUser(name: string, email: string, role?: string): Chainable<SeedUser>;
      seed(): Chainable<SeedResult>;
      assertStatusBadge(status: string): Chainable<void>;
      assertRoleBadge(role: string): Chainable<void>;
    }
  }
}

export {};
