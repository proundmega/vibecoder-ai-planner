const Approval = require('../models/approval');
const Ticket = require('../models/ticket');
const User = require('../models/user');

class ApprovalService {
  static async create(ticketId, requestedBy) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      throw new Error('Ticket not found');
    }
    
    const user = await User.find(requestedBy);
    if (!user) {
      throw new Error('User not found');
    }
    
    if (ticket.status !== 'review') {
      throw new Error('Can only request approval for tickets in review status');
    }
    
    const existing = await Approval.getByTicketAndRequester(ticketId, requestedBy);
    if (existing && existing.status === 'pending') {
      throw new Error('Approval request already pending for this ticket');
    }
    
    return await Approval.create(ticketId, requestedBy);
  }
  
  static async approve(approvalId, approvedBy) {
    const approval = await Approval.findById(approvalId);
    if (!approval) {
      throw new Error('Approval request not found');
    }
    
    if (approval.status !== 'pending') {
      throw new Error('Approval request is not pending');
    }
    
    const approvedUser = await User.find(approvedBy);
    if (!approvedUser) {
      throw new Error('Approver not found');
    }
    
    if (!['project_admin', 'member', 'super_admin'].includes(approvedUser.role)) {
      throw new Error('Only project admins, members, or super admins can approve requests');
    }
    
    const updated = await Approval.approve(approvalId, approvedBy);
    
    if (updated) {
      await Ticket.updateStatus(approval.ticket_id, 'done', approvedBy);
    }
    
    return updated;
  }
  
  static async reject(approvalId, approvedBy) {
    const approval = await Approval.findById(approvalId);
    if (!approval) {
      throw new Error('Approval request not found');
    }
    
    if (approval.status !== 'pending') {
      throw new Error('Approval request is not pending');
    }
    
    const approvedUser = await User.find(approvedBy);
    if (!approvedUser) {
      throw new Error('Approver not found');
    }
    
    if (!['project_admin', 'member', 'super_admin'].includes(approvedUser.role)) {
      throw new Error('Only project admins, members, or super admins can reject requests');
    }
    
    return await Approval.reject(approvalId, approvedBy);
  }
  
  static async getPendingByRequester(requestedBy) {
    return await Approval.getPendingByRequester(requestedBy);
  }
  
  static async getByTicketId(ticketId) {
    return await Approval.getByTicketId(ticketId);
  }
  
  static async getAll(filters = {}) {
    const { status, page = 1, perPage = 20 } = filters;
    const offset = (page - 1) * perPage;
    
    let whereClause = '1=1';
    const params = [];
    
    if (status) {
      params.push(status);
      whereClause += ` AND status = $${params.length}`;
    }
    
    const result = await Approval.pool.query(
      `SELECT * FROM approval_requests WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, perPage, offset]
    );
    
    const countResult = await Approval.pool.query(
      `SELECT COUNT(*) as total FROM approval_requests WHERE ${whereClause}`,
      params
    );
    
    return {
      approvals: result.rows,
      pagination: {
        page: parseInt(page),
        perPage: parseInt(perPage),
        total: parseInt(countResult.rows[0].total)
      }
    };
  }
}

module.exports = ApprovalService;
