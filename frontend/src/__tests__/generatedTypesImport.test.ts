import { describe, it, expect } from 'vitest'

describe('Generated types import', () => {
  it('can import all generated model types from index', async () => {
    // Type-only exports — import succeeds if the module resolves correctly
    await expect(import('@/api/generated/index')).resolves.toBeDefined()
  })

  it('can import all generated core types from index', async () => {
    const gen = await import('@/api/generated/index')
    expect(gen.ApiError).toBeDefined()
    expect(gen.CancelablePromise).toBeDefined()
    expect(gen.OpenAPI).toBeDefined()
  })

  it('can import all generated services from index', async () => {
    const gen = await import('@/api/generated/index')
    expect(gen.AgentsService).toBeDefined()
    expect(gen.ApprovalsService).toBeDefined()
    expect(gen.AttachmentsService).toBeDefined()
    expect(gen.AuthService).toBeDefined()
    expect(gen.BillingService).toBeDefined()
    expect(gen.CredentialsService).toBeDefined()
    expect(gen.GitHubService).toBeDefined()
    expect(gen.MemoryService).toBeDefined()
    expect(gen.PermissionsService).toBeDefined()
    expect(gen.PlanningService).toBeDefined()
    expect(gen.ProjectsService).toBeDefined()
    expect(gen.ProvidersService).toBeDefined()
    expect(gen.SystemService).toBeDefined()
    expect(gen.TicketsService).toBeDefined()
    expect(gen.UsageService).toBeDefined()
    expect(gen.UsersService).toBeDefined()
  })

  it('can import generated types from individual modules', async () => {
    // Type-only exports — import succeeds if the module resolves correctly
    await expect(import('@/api/generated/models/User')).resolves.toBeDefined()
    await expect(import('@/api/generated/models/Ticket')).resolves.toBeDefined()
    await expect(import('@/api/generated/models/Project')).resolves.toBeDefined()
    await expect(import('@/api/generated/models/Agent')).resolves.toBeDefined()
    await expect(import('@/api/generated/models/ApiResponse')).resolves.toBeDefined()
    await expect(import('@/api/generated/models/Error')).resolves.toBeDefined()
  })

  it('can import generated services from individual modules', async () => {
    const { AuthService } = await import('@/api/generated/services/AuthService')
    expect(AuthService).toBeDefined()

    const { ProjectsService } = await import('@/api/generated/services/ProjectsService')
    expect(ProjectsService).toBeDefined()

    const { TicketsService } = await import('@/api/generated/services/TicketsService')
    expect(TicketsService).toBeDefined()
  })

  it('OpenAPI config type is exported', async () => {
    const gen = await import('@/api/generated/index')
    // OpenAPIConfig is a type export — verify the namespace exists
    expect(gen).toHaveProperty('OpenAPI')
  })
})
