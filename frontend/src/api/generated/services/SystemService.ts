/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SystemService {
    /**
     * Health check
     * @returns any Server is healthy
     * @throws ApiError
     */
    public static getHealth(): CancelablePromise<{
        success?: boolean;
        data?: {
            status?: string;
            database?: string;
            timestamp?: string;
        };
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/health',
            errors: {
                503: `Database disconnected`,
            },
        });
    }
    /**
     * API version info
     * @returns any API version information
     * @throws ApiError
     */
    public static getVersion(): CancelablePromise<{
        success?: boolean;
        data?: {
            version?: string;
            name?: string;
        };
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/version',
        });
    }
    /**
     * API documentation index
     * @returns any API documentation endpoints
     * @throws ApiError
     */
    public static getDocs(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/docs',
        });
    }
    /**
     * Prometheus metrics endpoint
     * @param xMetricsToken Required if METRICS_TOKEN env var is set
     * @returns string Prometheus-format metrics (text/plain)
     * @throws ApiError
     */
    public static getMetrics(
        xMetricsToken?: string,
    ): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/metrics',
            headers: {
                'x-metrics-token': xMetricsToken,
            },
            errors: {
                401: `Unauthorized when METRICS_TOKEN is set and token is missing or incorrect`,
            },
        });
    }
    /**
     * CSP violation report endpoint
     * @param requestBody
     * @returns void
     * @throws ApiError
     */
    public static postCspReport(
        requestBody?: {
            'csp-report'?: {
                'document-uri'?: string;
                referrer?: string;
                'blocked-uri'?: string;
                'violated-directive'?: string;
                'original-policy'?: string;
            };
        },
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/csp-report',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
