/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NumericId } from '../models/NumericId';
import type { Ticket } from '../models/Ticket';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class TicketsService {
    /**
     * Create a new ticket
     * @param requestBody
     * @returns any Ticket created as a draft (readiness is enforced at execution, not creation)
     * @throws ApiError
     */
    public static postTickets(
        requestBody: {
            projectId: NumericId;
            title: string;
            description?: string;
            priority?: 'low' | 'medium' | 'high' | 'critical' | 'urgent';
            template?: 'architecture' | 'technical' | 'simple' | 'specification';
            acceptanceCriteria?: Array<string>;
            smallFix?: {
                reason?: string;
            };
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get tickets for a project
     * @param projectId
     * @param status
     * @returns any List of tickets
     * @throws ApiError
     */
    public static getTicketsProject(
        projectId: NumericId,
        status?: 'backlog' | 'in_progress' | 'review' | 'done',
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/project/{projectId}',
            path: {
                'projectId': projectId,
            },
            query: {
                'status': status,
            },
        });
    }
    /**
     * Get dependency-ready backlog tickets for agent execution
     * @param projectId
     * @returns any Backlog tickets whose dependencies are complete
     * @throws ApiError
     */
    public static getTicketsProjectBacklog(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/project/{projectId}/backlog',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Get single ticket
     * @param ticketId
     * @returns any Ticket details
     * @throws ApiError
     */
    public static getTickets(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/{ticketId}',
            path: {
                'ticketId': ticketId,
            },
            errors: {
                404: `Ticket not found`,
            },
        });
    }
    /**
     * Update ticket
     * @param ticketId
     * @param requestBody
     * @returns any Ticket updated
     * @throws ApiError
     */
    public static putTickets(
        ticketId: NumericId,
        requestBody?: {
            title?: string;
            description?: string;
            status?: string;
            priority?: string;
            assigneeId?: string | null;
            milestoneId?: string | null;
            estimate?: number | null;
            dependsOn?: Array<(number | string)>;
        },
    ): CancelablePromise<{
        success?: boolean;
        data?: Ticket;
    }> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/tickets/{ticketId}',
            path: {
                'ticketId': ticketId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `Ticket has incomplete dependencies or is not ready for execution (READINESS_FAILED)`,
            },
        });
    }
    /**
     * Delete ticket
     * @param ticketId
     * @returns any Ticket deleted
     * @throws ApiError
     */
    public static deleteTickets(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/tickets/{ticketId}',
            path: {
                'ticketId': ticketId,
            },
            errors: {
                409: `Ticket is in progress and must be moved to backlog before deletion`,
            },
        });
    }
    /**
     * Change ticket status (agent workflow)
     * @param ticketId
     * @param requestBody
     * @returns any Status updated
     * @throws ApiError
     */
    public static postTicketsStatus(
        ticketId: NumericId,
        requestBody?: {
            status?: 'backlog' | 'in_progress' | 'review' | 'done';
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{ticketId}/status',
            path: {
                'ticketId': ticketId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `Ticket has incomplete dependencies`,
            },
        });
    }
    /**
     * Evaluate the ticket Definition of Ready
     * @param ticketId
     * @returns any Readiness result with issues
     * @throws ApiError
     */
    public static getTicketsReadiness(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/{ticketId}/readiness',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * Approve the plan (content-bound readiness approval)
     * @param ticketId
     * @returns any Plan approved
     * @throws ApiError
     */
    public static postTicketsReadinessApprovePlan(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{ticketId}/readiness/approve-plan',
            path: {
                'ticketId': ticketId,
            },
            errors: {
                409: `Readiness checks still fail`,
            },
        });
    }
    /**
     * Record a small-fix template exemption
     * @param ticketId
     * @param requestBody
     * @returns any Exemption recorded
     * @throws ApiError
     */
    public static postTicketsReadinessSmallFix(
        ticketId: NumericId,
        requestBody: {
            reason: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{ticketId}/readiness/small-fix',
            path: {
                'ticketId': ticketId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Reopen planning and clear approval/ready state
     * @param ticketId
     * @returns any Planning reopened
     * @throws ApiError
     */
    public static postTicketsReadinessReplan(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{ticketId}/readiness/replan',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * Grant a scoped, expiring readiness waiver
     * @param ticketId
     * @param requestBody
     * @returns any Override granted
     * @throws ApiError
     */
    public static postTicketsReadinessOverride(
        ticketId: NumericId,
        requestBody: {
            codes: Array<string>;
            reason: string;
            expiresAt: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{ticketId}/readiness/override',
            path: {
                'ticketId': ticketId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Revoke a readiness waiver
     * @param ticketId
     * @returns any Override revoked
     * @throws ApiError
     */
    public static deleteTicketsReadinessOverride(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/tickets/{ticketId}/readiness/override',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * List acceptance criteria
     * @param ticketId
     * @returns any Acceptance criteria
     * @throws ApiError
     */
    public static getTicketsAcceptanceCriteria(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/{ticketId}/acceptance-criteria',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * Add acceptance criteria (array or { criteria })
     * @param ticketId
     * @returns any Criteria created
     * @throws ApiError
     */
    public static postTicketsAcceptanceCriteria(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{ticketId}/acceptance-criteria',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * Agent picks up a ticket
     * @param ticketId
     * @returns any Ticket picked up
     * @throws ApiError
     */
    public static postTicketsPickup(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{ticketId}/pickup',
            path: {
                'ticketId': ticketId,
            },
            errors: {
                409: `Ticket has incomplete dependencies`,
            },
        });
    }
    /**
     * Agent releases a ticket
     * @param ticketId
     * @returns any Ticket released
     * @throws ApiError
     */
    public static postTicketsRelease(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{ticketId}/release',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * Get ticket comments
     * @param ticketId
     * @returns any List of comments
     * @throws ApiError
     */
    public static getTicketsComments(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/{ticketId}/comments',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * Add comment to ticket
     * @param ticketId
     * @param requestBody
     * @returns any Comment added
     * @throws ApiError
     */
    public static postTicketsComments(
        ticketId: NumericId,
        requestBody?: {
            content?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{ticketId}/comments',
            path: {
                'ticketId': ticketId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get ticket messages
     * @param ticketId
     * @param limit
     * @returns any List of messages
     * @throws ApiError
     */
    public static getTicketsMessages(
        ticketId: NumericId,
        limit?: number,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/{ticketId}/messages',
            path: {
                'ticketId': ticketId,
            },
            query: {
                'limit': limit,
            },
        });
    }
    /**
     * Post message to ticket
     * @param ticketId
     * @param requestBody
     * @returns any Message posted
     * @throws ApiError
     */
    public static postTicketsMessages(
        ticketId: NumericId,
        requestBody?: {
            messageType?: string;
            content?: string;
            metadata?: Record<string, any>;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{ticketId}/messages',
            path: {
                'ticketId': ticketId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get phase transition history
     * @param ticketId
     * @returns any Phase history
     * @throws ApiError
     */
    public static getTicketsPhases(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/{ticketId}/phases',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * Get current phase
     * @param ticketId
     * @returns any Current phase
     * @throws ApiError
     */
    public static getTicketsPhasesCurrent(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/{ticketId}/phases/current',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * Get allowed next phases
     * @param ticketId
     * @returns any Allowed next phases
     * @throws ApiError
     */
    public static getTicketsPhasesAllowed(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/{ticketId}/phases/allowed',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * Transition ticket to a new phase
     * @param ticketId
     * @param requestBody
     * @returns any Phase transitioned
     * @throws ApiError
     */
    public static postTicketsPhasesTransition(
        ticketId: NumericId,
        requestBody?: {
            toPhase: string;
            actorType?: 'human' | 'agent' | 'system';
            metadata?: Record<string, any>;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{ticketId}/phases/transition',
            path: {
                'ticketId': ticketId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `Phase enters execution but dependencies are incomplete`,
            },
        });
    }
    /**
     * Get PR diff for a ticket
     * @param ticketId
     * @returns any PR diff files
     * @throws ApiError
     */
    public static getTicketsReviewDiff(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/{ticketId}/review/diff',
            path: {
                'ticketId': ticketId,
            },
            errors: {
                400: `No PR linked or invalid URL`,
                404: `Ticket not found`,
            },
        });
    }
}
