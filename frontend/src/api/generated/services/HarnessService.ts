/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NumericId } from '../models/NumericId';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class HarnessService {
    /**
     * Start a durable harness run for an assigned agent ticket
     * @param requestBody
     * @returns any Harness run created
     * @throws ApiError
     */
    public static postHarnessRuns(
        requestBody: {
            ticketId: NumericId;
            branch: string;
            baseSha?: string | null;
            workspacePath?: string | null;
            sessionId?: string | null;
            provider?: string | null;
            model?: string | null;
            attempt?: number;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/harness/runs',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `Incomplete dependencies, an active run, or published work already exists`,
            },
        });
    }
}
