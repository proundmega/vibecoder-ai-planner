/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PlanningService {
    /**
     * List planning files for a ticket
     * @param id
     * @returns any Planning files list
     * @throws ApiError
     */
    public static getTicketsPlanning(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/{id}/planning',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get a specific planning file
     * @param id
     * @param fileKey
     * @returns any Planning file content
     * @throws ApiError
     */
    public static getTicketsPlanning1(
        id: string,
        fileKey: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/{id}/planning/{fileKey}',
            path: {
                'id': id,
                'fileKey': fileKey,
            },
        });
    }
    /**
     * Create or update a planning file
     * @param id
     * @param fileKey
     * @param requestBody
     * @returns any Planning file updated
     * @throws ApiError
     */
    public static putTicketsPlanning(
        id: string,
        fileKey: string,
        requestBody: {
            content: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/tickets/{id}/planning/{fileKey}',
            path: {
                'id': id,
                'fileKey': fileKey,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Apply a template to create initial planning files
     * @param id
     * @param requestBody
     * @returns any Template applied
     * @throws ApiError
     */
    public static postTicketsPlanningApplyTemplate(
        id: string,
        requestBody: {
            templateName: 'architecture' | 'technical' | 'simple' | 'specification';
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{id}/planning/apply-template',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Update planning status
     * @param id
     * @param requestBody
     * @returns any Status updated
     * @throws ApiError
     */
    public static patchTicketsPlanningStatus(
        id: string,
        requestBody: {
            status: 'not_started' | 'template_selected' | 'in_progress' | 'review' | 'completed';
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/tickets/{id}/planning/status',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
