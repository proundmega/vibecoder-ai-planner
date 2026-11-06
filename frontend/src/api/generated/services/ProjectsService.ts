/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NumericId } from '../models/NumericId';
import type { Project } from '../models/Project';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ProjectsService {
    /**
     * List projects for current user
     * @returns any List of projects
     * @throws ApiError
     */
    public static getProjects(): CancelablePromise<{
        success?: boolean;
        data?: Array<Project>;
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects',
        });
    }
    /**
     * Create a new project
     * @param requestBody
     * @returns any Project created
     * @throws ApiError
     */
    public static postProjects(
        requestBody: {
            name: string;
            description?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Validation error`,
            },
        });
    }
    /**
     * Get project details
     * @param id
     * @returns any Project details with ticket info
     * @throws ApiError
     */
    public static getProjects1(
        id: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{id}',
            path: {
                'id': id,
            },
            errors: {
                404: `Project not found`,
            },
        });
    }
    /**
     * Update project
     * @param id
     * @param requestBody
     * @returns any Project updated
     * @throws ApiError
     */
    public static putProjects(
        id: NumericId,
        requestBody?: {
            name?: string;
            description?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/projects/{id}',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                404: `Project not found`,
            },
        });
    }
    /**
     * Delete project
     * @param id
     * @returns any Project deleted
     * @throws ApiError
     */
    public static deleteProjects(
        id: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/projects/{id}',
            path: {
                'id': id,
            },
            errors: {
                404: `Project not found`,
            },
        });
    }
    /**
     * Get all tickets for a project
     * @param id
     * @returns any List of tickets
     * @throws ApiError
     */
    public static getProjectsTickets(
        id: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{id}/tickets',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Create ticket in project
     * @param id
     * @param requestBody
     * @returns any Ticket created
     * @throws ApiError
     */
    public static postProjectsTickets(
        id: NumericId,
        requestBody: {
            title: string;
            description?: string;
            priority?: 'low' | 'medium' | 'high' | 'critical' | 'urgent';
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{id}/tickets',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get tickets by status
     * @param id
     * @param status
     * @returns any Filtered tickets
     * @throws ApiError
     */
    public static getProjectsTicketsStatus(
        id: NumericId,
        status: 'backlog' | 'in_progress' | 'review' | 'done',
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{id}/tickets/status/{status}',
            path: {
                'id': id,
                'status': status,
            },
        });
    }
    /**
     * Get project members
     * @param id
     * @returns any List of project members
     * @throws ApiError
     */
    public static getProjectsMembers(
        id: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{id}/members',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get users who can be assigned to tickets
     * @param id
     * @returns any List of assignable users
     * @throws ApiError
     */
    public static getProjectsUsers(
        id: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{id}/users',
            path: {
                'id': id,
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
    public static putProjectsTickets(
        ticketId: NumericId,
        requestBody?: {
            title?: string;
            description?: string;
            status?: string;
            priority?: string;
            assigneeId?: NumericId;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/projects/tickets/{ticketId}',
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
    public static deleteProjectsTickets(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/projects/tickets/{ticketId}',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * Update ticket status
     * @param id
     * @param ticketId
     * @param requestBody
     * @returns any Status updated
     * @throws ApiError
     */
    public static postProjectsTicketsStatus(
        id: NumericId,
        ticketId: NumericId,
        requestBody?: {
            status?: 'backlog' | 'in_progress' | 'review' | 'done';
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{id}/tickets/{ticketId}/status',
            path: {
                'id': id,
                'ticketId': ticketId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
