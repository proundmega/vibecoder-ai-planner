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
            providerBaseUrl?: string | null;
            providerRegion?: string | null;
            attempt?: number;
            repoProfileId?: string | null;
            repoProfileVersion?: number | null;
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
    /**
     * Append a structured harness event
     * @param requestBody
     * @returns any Event stored (or an existing idempotent duplicate)
     * @throws ApiError
     */
    public static postHarnessEvents(
        requestBody: {
            eventId: string;
            traceId: string;
            runId: string;
            type: string;
            version?: number;
            sessionId?: string | null;
            timestamp?: string;
            payload?: Record<string, any>;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/harness/events',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Report a cumulative usage snapshot for a harness run
     * @param runId
     * @returns any Usage stored (greatest value wins on retries)
     * @throws ApiError
     */
    public static postHarnessRunsUsage(
        runId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/harness/runs/{runId}/usage',
            path: {
                'runId': runId,
            },
        });
    }
    /**
     * Read per-model usage for a harness run
     * @param runId
     * @returns any Usage rows and totals
     * @throws ApiError
     */
    public static getHarnessRunsUsage(
        runId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/runs/{runId}/usage',
            path: {
                'runId': runId,
            },
        });
    }
    /**
     * List the ordered events for a harness run
     * @param runId
     * @param limit
     * @param before Keyset cursor timestamp; requires beforeId
     * @param beforeId Keyset cursor event id for the same timestamp
     * @returns any Ordered events
     * @throws ApiError
     */
    public static getHarnessRunsEvents(
        runId: string,
        limit?: number,
        before?: string,
        beforeId?: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/runs/{runId}/events',
            path: {
                'runId': runId,
            },
            query: {
                'limit': limit,
                'before': before,
                'beforeId': beforeId,
            },
        });
    }
    /**
     * Replay timeline for a harness run (events, checkpoints, artifacts)
     * @throws ApiError
     */
    public static getHarnessRunsTimeline(): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/runs/{runId}/timeline',
        });
    }
    /**
     * List recent harness runs for a project (replay picker)
     * @param projectId
     * @param limit
     * @returns any Recent runs
     * @throws ApiError
     */
    public static getHarnessProjectsRuns(
        projectId: NumericId,
        limit?: number,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/projects/{projectId}/runs',
            path: {
                'projectId': projectId,
            },
            query: {
                'limit': limit,
            },
        });
    }
    /**
     * Query project-scoped harness events
     * @param projectId
     * @param type
     * @returns any Events
     * @throws ApiError
     */
    public static getHarnessProjectsEvents(
        projectId: NumericId,
        type?: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/projects/{projectId}/events',
            path: {
                'projectId': projectId,
            },
            query: {
                'type': type,
            },
        });
    }
    /**
     * List immutable publish/review audit records
     * @param projectId
     * @returns any Audit events
     * @throws ApiError
     */
    public static getHarnessProjectsAudit(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/projects/{projectId}/audit',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Harness runs, cost, review/fix rounds and alerts for a project
     * @param projectId
     * @param since
     * @param until
     * @returns any Dashboard data
     * @throws ApiError
     */
    public static getHarnessProjectsDashboard(
        projectId: NumericId,
        since?: string,
        until?: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/projects/{projectId}/dashboard',
            path: {
                'projectId': projectId,
            },
            query: {
                'since': since,
                'until': until,
            },
        });
    }
    /**
     * Harness token/cost usage grouped by model
     * @param projectId
     * @returns any Usage summary
     * @throws ApiError
     */
    public static getHarnessProjectsUsage(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/projects/{projectId}/usage',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Read the project harness privacy and data-governance policy
     * @param projectId
     * @returns any Effective privacy policy
     * @throws ApiError
     */
    public static getHarnessProjectsPrivacyPolicy(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/projects/{projectId}/privacy-policy',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Update the project privacy policy
     * @param projectId
     * @param requestBody
     * @returns any Updated privacy policy
     * @throws ApiError
     */
    public static putHarnessProjectsPrivacyPolicy(
        projectId: NumericId,
        requestBody?: {
            maxDataClass?: 'public' | 'internal' | 'confidential' | 'secret';
            allowedProviders?: Array<string>;
            requireNoTraining?: boolean;
            localOnly?: boolean;
            localEndpoint?: string | null;
            localModel?: string | null;
            dataResidency?: string | null;
            blockOnSecret?: boolean;
            blockOnPii?: boolean;
            redactPii?: boolean;
            eventRetentionDays?: number;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/harness/projects/{projectId}/privacy-policy',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete project-scoped run data (audit tombstone retained)
     * @param projectId
     * @param requestBody
     * @returns any Deletion counts
     * @throws ApiError
     */
    public static postHarnessProjectsPrivacyDelete(
        projectId: NumericId,
        requestBody?: {
            dataClasses?: Array<'events' | 'usage' | 'messages' | 'checkpoints' | 'runs' | 'usage_logs' | 'all'>;
            before?: string | null;
            reason?: string | null;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/harness/projects/{projectId}/privacy/delete',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Export project harness run data
     * @param projectId
     * @param limit
     * @param offset
     * @returns any Redacted project run data export (offset-paginated; each page is an independent snapshot)
     * @throws ApiError
     */
    public static getHarnessProjectsPrivacyExport(
        projectId: NumericId,
        limit?: number,
        offset?: number,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/projects/{projectId}/privacy/export',
            path: {
                'projectId': projectId,
            },
            query: {
                'limit': limit,
                'offset': offset,
            },
        });
    }
    /**
     * Read the effective budget and routing policy
     * @param projectId
     * @returns any Effective policy
     * @throws ApiError
     */
    public static getHarnessProjectsBudgetPolicy(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/projects/{projectId}/budget-policy',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Update the project budget and routing policy
     * @param projectId
     * @returns any Updated policy
     * @throws ApiError
     */
    public static putHarnessProjectsBudgetPolicy(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/harness/projects/{projectId}/budget-policy',
            path: {
                'projectId': projectId,
            },
            errors: {
                403: `Project admin required`,
            },
        });
    }
    /**
     * List immutable kill-switch history for a project (including global)
     * @param projectId
     * @returns any Kill-switch audit rows
     * @throws ApiError
     */
    public static getHarnessProjectsKillSwitchAudit(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/projects/{projectId}/kill-switch/audit',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Read the project kill switch
     * @param projectId
     * @returns any Active project/global kill switch or null
     * @throws ApiError
     */
    public static getHarnessProjectsKillSwitch(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/projects/{projectId}/kill-switch',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Enable or disable the project kill switch
     * @param projectId
     * @returns any Updated switch
     * @throws ApiError
     */
    public static putHarnessProjectsKillSwitch(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/harness/projects/{projectId}/kill-switch',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Read the global harness kill switch
     * @returns any Active global switch or null
     * @throws ApiError
     */
    public static getHarnessKillSwitch(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/harness/kill-switch',
        });
    }
    /**
     * Enable or disable the global harness kill switch
     * @returns any Updated switch
     * @throws ApiError
     */
    public static putHarnessKillSwitch(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/harness/kill-switch',
            errors: {
                403: `super_admin required`,
            },
        });
    }
}
