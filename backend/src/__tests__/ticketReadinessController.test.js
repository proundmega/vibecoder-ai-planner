jest.mock('../services/TicketReadinessService', () => ({
  getReadiness: jest.fn(),
}));

jest.mock('../services/ProjectAccessService', () => ({
  actorUserId: jest.fn(user => user?.userId ?? null),
  isProjectMember: jest.fn(),
}));

const TicketReadinessService = require('../services/TicketReadinessService');
const ProjectAccessService = require('../services/ProjectAccessService');
const TicketReadinessController = require('../controllers/ticketReadinessController');

function response() {
  return { json: jest.fn() };
}

describe('ticket readiness capability response', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    TicketReadinessService.getReadiness.mockResolvedValue({
      ticketId: '1',
      projectId: '7',
      ready: false,
      issues: [],
      waivedCodes: [],
    });
  });

  test('a non-member super_admin keeps the criteria controls', async () => {
    ProjectAccessService.isProjectMember.mockResolvedValue(false);
    const res = response();

    await TicketReadinessController.get({
      params: { ticketId: '1' },
      user: { userId: 5, role: 'super_admin' },
    }, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ canEditCriteria: true, projectId: '7' }),
    });
    expect(ProjectAccessService.isProjectMember).not.toHaveBeenCalled();
  });

  test('a non-member member does not get the criteria controls', async () => {
    ProjectAccessService.isProjectMember.mockResolvedValue(false);
    const res = response();

    await TicketReadinessController.get({
      params: { ticketId: '1' },
      user: { userId: 5, role: 'member' },
    }, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ canEditCriteria: false }),
    });
  });

  test('a project member gets the criteria controls', async () => {
    ProjectAccessService.isProjectMember.mockResolvedValue(true);
    const res = response();

    await TicketReadinessController.get({
      params: { ticketId: '1' },
      user: { userId: 5, role: 'member' },
    }, res);

    expect(ProjectAccessService.isProjectMember).toHaveBeenCalledWith(5, '7');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ canEditCriteria: true }),
    });
  });
});
