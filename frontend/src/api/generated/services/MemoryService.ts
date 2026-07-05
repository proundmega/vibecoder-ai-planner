/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class MemoryService {
    /**
     * Get memories for a project
     * @param projectId
     * @returns any List of memories
     * @throws ApiError
     */
    public static getMemoryProject(
        projectId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/memory/project/{projectId}',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Add memory to a project
     * @param projectId
     * @param requestBody
     * @returns any Memory added
     * @throws ApiError
     */
    public static postMemoryProject(
        projectId: string,
        requestBody?: {
            content?: string;
            metadata?: Record<string, any>;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/memory/project/{projectId}',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Search memories in a project
     * @param projectId
     * @param q
     * @returns any Search results
     * @throws ApiError
     */
    public static getMemoryProjectSearch(
        projectId: string,
        q: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/memory/project/{projectId}/search',
            path: {
                'projectId': projectId,
            },
            query: {
                'q': q,
            },
        });
    }
    /**
     * Get memories for an agent
     * @param agentId
     * @returns any List of agent memories
     * @throws ApiError
     */
    public static getMemoryAgent(
        agentId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/memory/agent/{agentId}',
            path: {
                'agentId': agentId,
            },
        });
    }
    /**
     * Get a specific memory
     * @param id
     * @returns any Memory details
     * @throws ApiError
     */
    public static getMemory(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/memory/{id}',
            path: {
                'id': id,
            },
            errors: {
                404: `Memory not found`,
            },
        });
    }
    /**
     * Update a memory
     * @param id
     * @param requestBody
     * @returns any Memory updated
     * @throws ApiError
     */
    public static putMemory(
        id: string,
        requestBody?: {
            content?: string;
            metadata?: Record<string, any>;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/memory/{id}',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete a memory
     * @param id
     * @returns any Memory deleted
     * @throws ApiError
     */
    public static deleteMemory(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/memory/{id}',
            path: {
                'id': id,
            },
            errors: {
                404: `Memory not found`,
            },
        });
    }
}
