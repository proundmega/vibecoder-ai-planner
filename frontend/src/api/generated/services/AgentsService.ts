/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Agent } from '../models/Agent';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AgentsService {
    /**
     * Create a new agent
     * @param requestBody
     * @returns any Agent created with API key
     * @throws ApiError
     */
    public static postAgentsCreate(
        requestBody?: {
            name?: string;
        },
    ): CancelablePromise<{
        id?: string;
        name?: string;
        user_id?: string;
        api_key?: string;
        generatedApiKey?: string;
    }> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/agents/create',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Creation failed`,
            },
        });
    }
    /**
     * List user's agents
     * @returns any List of agents
     * @throws ApiError
     */
    public static getAgents(): CancelablePromise<{
        agents?: Array<Agent>;
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/agents',
        });
    }
    /**
     * Revoke agent API key
     * @param agentId
     * @returns any API key revoked
     * @throws ApiError
     */
    public static postAgentsRevoke(
        agentId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/agents/revoke/{agentId}',
            path: {
                'agentId': agentId,
            },
            errors: {
                400: `Revoke failed`,
            },
        });
    }
    /**
     * Delete agent
     * @param agentId
     * @returns any Agent deleted
     * @throws ApiError
     */
    public static deleteAgents(
        agentId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/agents/{agentId}',
            path: {
                'agentId': agentId,
            },
            errors: {
                400: `Deletion failed`,
            },
        });
    }
    /**
     * Get agent activity history
     * @param agentId
     * @returns any Agent activity history
     * @throws ApiError
     */
    public static getAgentsHistory(
        agentId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/agents/{agentId}/history',
            path: {
                'agentId': agentId,
            },
            errors: {
                403: `Forbidden`,
            },
        });
    }
    /**
     * Get agent API key info (preview only)
     * @param agentId
     * @returns any Agent key info
     * @throws ApiError
     */
    public static getAgentsKey(
        agentId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/agents/{agentId}/key',
            path: {
                'agentId': agentId,
            },
            errors: {
                404: `Agent not found`,
            },
        });
    }
}
