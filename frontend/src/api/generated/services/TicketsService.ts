/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class TicketsService {
    /**
     * Create a new ticket
     * @param requestBody
     * @returns any Ticket created
     * @throws ApiError
     */
    public static postTickets(
        requestBody: {
            projectId: string;
            title: string;
            description?: string;
            priority?: 'low' | 'medium' | 'high' | 'urgent';
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
        projectId: string,
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
     * Get single ticket
     * @param ticketId
     * @returns any Ticket details
     * @throws ApiError
     */
    public static getTickets(
        ticketId: string,
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
        ticketId: string,
        requestBody?: {
            title?: string;
            description?: string;
            status?: string;
            priority?: string;
            assigneeId?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/tickets/{ticketId}',
            path: {
                'ticketId': ticketId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete ticket
     * @param ticketId
     * @returns any Ticket deleted
     * @throws ApiError
     */
    public static deleteTickets(
        ticketId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/tickets/{ticketId}',
            path: {
                'ticketId': ticketId,
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
        ticketId: string,
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
        });
    }
    /**
     * Agent picks up a ticket
     * @param ticketId
     * @returns any Ticket picked up
     * @throws ApiError
     */
    public static postTicketsPickup(
        ticketId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{ticketId}/pickup',
            path: {
                'ticketId': ticketId,
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
        ticketId: string,
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
        ticketId: string,
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
        ticketId: string,
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
        ticketId: string,
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
        ticketId: string,
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
        ticketId: string,
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
        ticketId: string,
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
        ticketId: string,
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
        ticketId: string,
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
        });
    }
    /**
     * Get PR diff for a ticket
     * @param ticketId
     * @returns any PR diff files
     * @throws ApiError
     */
    public static getTicketsReviewDiff(
        ticketId: string,
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
