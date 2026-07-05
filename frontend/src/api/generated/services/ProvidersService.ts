/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ProvidersService {
    /**
     * List providers for project
     * @param projectId
     * @returns any List of providers
     * @throws ApiError
     */
    public static getProvidersProviders(
        projectId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/providers/{projectId}/providers',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Add provider to project
     * @param projectId
     * @param requestBody
     * @returns any Provider added
     * @throws ApiError
     */
    public static postProvidersProviders(
        projectId: string,
        requestBody?: {
            name?: string;
            provider?: string;
            apiKey?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/providers/{projectId}/providers',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Update provider
     * @param projectId
     * @param providerId
     * @param requestBody
     * @returns any Provider updated
     * @throws ApiError
     */
    public static patchProvidersProviders(
        projectId: string,
        providerId: string,
        requestBody?: {
            name?: string;
            apiKey?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/providers/{projectId}/providers/{providerId}',
            path: {
                'projectId': projectId,
                'providerId': providerId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete provider
     * @param projectId
     * @param providerId
     * @returns any Provider deleted
     * @throws ApiError
     */
    public static deleteProvidersProviders(
        projectId: string,
        providerId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/providers/{projectId}/providers/{providerId}',
            path: {
                'projectId': projectId,
                'providerId': providerId,
            },
        });
    }
    /**
     * Test provider connection
     * @param projectId
     * @param providerId
     * @returns any Connection test result
     * @throws ApiError
     */
    public static postProvidersProvidersTest(
        projectId: string,
        providerId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/providers/{projectId}/providers/{providerId}/test',
            path: {
                'projectId': projectId,
                'providerId': providerId,
            },
        });
    }
    /**
     * Set provider as project director
     * @param projectId
     * @param providerId
     * @returns any Provider set as director
     * @throws ApiError
     */
    public static patchProvidersProvidersDirectorate(
        projectId: string,
        providerId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/providers/{projectId}/providers/{providerId}/directorate',
            path: {
                'projectId': projectId,
                'providerId': providerId,
            },
        });
    }
    /**
     * Resolve AI provider for a ticket based on routing rules
     * @param projectId
     * @param requestBody
     * @returns any Resolved provider config
     * @throws ApiError
     */
    public static postProvidersProviderResolve(
        projectId: string,
        requestBody: {
            ticket_id?: string;
            labels?: Array<string>;
            priority?: string;
            phase?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/providers/{projectId}/provider/resolve',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
