/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class CspService {
    /**
     * List CSP violations
     * @param limit
     * @param offset
     * @param directive
     * @returns any Paginated list of CSP violations
     * @throws ApiError
     */
    public static getV1CspViolations(
        limit: number = 20,
        offset?: number,
        directive?: string,
    ): CancelablePromise<{
        success?: boolean;
        data?: {
            violations?: Array<Record<string, any>>;
            total?: number;
            limit?: number;
            offset?: number;
        };
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v1/csp-violations',
            query: {
                'limit': limit,
                'offset': offset,
                'directive': directive,
            },
        });
    }
    /**
     * Clear all CSP violations
     * @returns any All violations cleared
     * @throws ApiError
     */
    public static deleteV1CspViolations(): CancelablePromise<{
        success?: boolean;
        data?: {
            deletedCount?: number;
        };
    }> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/v1/csp-violations',
        });
    }
}
