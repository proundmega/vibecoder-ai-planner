/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ApprovalsService {
    /**
     * Create approval request
     * @param requestBody
     * @returns any Approval request created
     * @throws ApiError
     */
    public static postApprovals(
        requestBody?: {
            ticketId?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/approvals',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Validation error`,
            },
        });
    }
    /**
     * Get all approvals (super admin only)
     * @param status
     * @param page
     * @param perPage
     * @returns any List of all approvals
     * @throws ApiError
     */
    public static getApprovals(
        status?: string,
        page?: number,
        perPage?: number,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/approvals',
            query: {
                'status': status,
                'page': page,
                'perPage': perPage,
            },
            errors: {
                403: `Forbidden - super admin only`,
            },
        });
    }
    /**
     * Get pending approvals for current user
     * @returns any List of pending approvals
     * @throws ApiError
     */
    public static getApprovalsPending(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/approvals/pending',
        });
    }
    /**
     * Get approvals for a ticket
     * @param ticketId
     * @returns any List of approvals for ticket
     * @throws ApiError
     */
    public static getApprovalsTicket(
        ticketId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/approvals/ticket/{ticketId}',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * Approve request
     * @param approvalId
     * @returns any Approval approved
     * @throws ApiError
     */
    public static postApprovalsApprove(
        approvalId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/approvals/{approvalId}/approve',
            path: {
                'approvalId': approvalId,
            },
            errors: {
                400: `Approval failed`,
            },
        });
    }
    /**
     * Reject request
     * @param approvalId
     * @returns any Approval rejected
     * @throws ApiError
     */
    public static postApprovalsReject(
        approvalId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/approvals/{approvalId}/reject',
            path: {
                'approvalId': approvalId,
            },
            errors: {
                400: `Rejection failed`,
            },
        });
    }
}
