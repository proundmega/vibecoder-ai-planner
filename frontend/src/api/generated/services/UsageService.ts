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
}
