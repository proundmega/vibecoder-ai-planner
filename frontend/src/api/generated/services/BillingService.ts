/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class BillingService {
    /**
     * Get billing for a project
     * @param id
     * @returns any Billing data for project
     * @throws ApiError
     */
    public static getBillingProjectsBilling(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/billing/projects/{id}/billing',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get billing for current user
     * @returns any Billing data for user
     * @throws ApiError
     */
    public static getBillingUsersMeBilling(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/billing/users/me/billing',
        });
    }
    /**
     * Trigger daily billing aggregation
     * @param requestBody
     * @returns any Aggregation completed
     * @throws ApiError
     */
    public static postBillingAggregate(
        requestBody?: {
            date?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/billing/aggregate',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                403: `Insufficient permissions`,
            },
        });
    }
}
