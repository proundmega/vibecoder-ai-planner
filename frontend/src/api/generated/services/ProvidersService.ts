/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ProvidersService {
    /**
     * List all providers
     * @returns any List of providers
     * @throws ApiError
     */
    public static getProviders(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/providers',
        });
    }
    /**
     * Add a new provider
     * @param requestBody
     * @returns any Provider created
     * @throws ApiError
     */
    public static postProviders(
        requestBody?: {
            name?: string;
            providerType?: string;
            apiKey?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/providers',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get a provider by ID
     * @param id
     * @returns any Provider details
     * @throws ApiError
     */
    public static getProviders1(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/providers/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Update a provider
     * @param id
     * @param requestBody
     * @returns any Provider updated
     * @throws ApiError
     */
    public static patchProviders(
        id: string,
        requestBody?: {
            name?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/providers/{id}',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete a provider
     * @param id
     * @returns any Provider deleted
     * @throws ApiError
     */
    public static deleteProviders(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/providers/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Test provider connection
     * @param id
     * @returns any Connection test result
     * @throws ApiError
     */
    public static postProvidersTest(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/providers/{id}/test',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Set provider as director
     * @param id
     * @returns any Directorship updated
     * @throws ApiError
     */
    public static patchProvidersDirectorship(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/providers/{id}/directorship',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get agents for a provider
     * @param id
     * @returns any List of agents
     * @throws ApiError
     */
    public static getProvidersAgents(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/providers/{id}/agents',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Resolve provider for a ticket
     * @param requestBody
     * @returns any Resolved provider config
     * @throws ApiError
     */
    public static postProvidersResolve(
        requestBody?: {
            labels?: Array<string>;
            priority?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/providers/resolve',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
