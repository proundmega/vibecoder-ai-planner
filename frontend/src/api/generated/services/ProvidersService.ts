/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NumericId } from '../models/NumericId';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ProvidersService {
    /**
     * Resolve provider for a ticket
     * Selects a verified registry model by role or phase. Legacy labels/priority routing is not used.
     * @param requestBody
     * @returns any Resolved provider config
     * @throws ApiError
     */
    public static postProvidersResolve(
        requestBody?: {
            phase?: string;
            role?: 'worker' | 'reviewer' | 'planner';
            project_id?: NumericId;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/providers/resolve',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                403: `Caller cannot access the requested project`,
            },
        });
    }
}
