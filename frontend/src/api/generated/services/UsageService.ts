/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class UsageService {
    /**
     * Get usage for a project
     * @param id
     * @returns any Usage data for project
     * @throws ApiError
     */
    public static getUsageProjectsUsage(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/usage/projects/{id}/usage',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get usage for current user
     * @returns any Usage data for user
     * @throws ApiError
     */
    public static getUsageUsersMeUsage(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/usage/users/me/usage',
        });
    }
    /**
     * Get model pricing info
     * @returns any Pricing information for all models
     * @throws ApiError
     */
    public static getUsagePricingModels(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/usage/pricing/models',
        });
    }
    /**
     * Java agent reports usage after AI call
     * @param agentId
     * @param requestBody
     * @returns any Usage recorded
     * @throws ApiError
     */
    public static postUsageAgentsUsage(
        agentId: number,
        requestBody: {
            provider_type: string;
            model: string;
            tokens_in: number;
            tokens_out: number;
            duration_ms?: number;
            ticket_id?: number;
            project_id?: number;
            planning_stage?: 'requirement_extraction' | 'plan_generation' | 'refinement' | 'validation';
            file_keys?: Array<string>;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/usage/agents/{agentId}/usage',
            path: {
                'agentId': agentId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Missing required fields`,
                401: `Missing or invalid API key`,
                403: `Agent ID mismatch — agent can only report its own usage`,
            },
        });
    }
}
