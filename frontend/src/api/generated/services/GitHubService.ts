/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NumericId } from '../models/NumericId';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class GitHubService {
    /**
     * Get repository connection status
     * @param projectId
     * @returns any Repository status
     * @throws ApiError
     */
    public static getGithubRepo(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/github/{projectId}/repo',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Disconnect repository
     * @param projectId
     * @returns any Repository disconnected
     * @throws ApiError
     */
    public static deleteGithubRepo(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/github/{projectId}/repo',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Get repository connection for agent (with decrypted PAT)
     * @param projectId
     * @returns any Repository config with decrypted access token
     * @throws ApiError
     */
    public static getGithubRepoAgent(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/github/{projectId}/repo/agent',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Connect repository to project
     * @param projectId
     * @param requestBody
     * @returns any Repository connected
     * @throws ApiError
     */
    public static postGithubRepoConnect(
        projectId: NumericId,
        requestBody?: {
            repoUrl?: string;
            branch?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/github/{projectId}/repo/connect',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * List branches for project
     * @param projectId
     * @returns any List of branches
     * @throws ApiError
     */
    public static getGithubBranches(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/github/{projectId}/branches',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Create branch for ticket
     * @param ticketId
     * @returns any Branch created
     * @throws ApiError
     */
    public static postGithubBranch(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/github/{ticketId}/branch',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * Delete branch for ticket
     * @param ticketId
     * @returns any Branch deleted
     * @throws ApiError
     */
    public static deleteGithubBranch(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/github/{ticketId}/branch',
            path: {
                'ticketId': ticketId,
            },
        });
    }
    /**
     * List pull requests for project
     * @param projectId
     * @returns any List of PRs
     * @throws ApiError
     */
    public static getGithubPrs(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/github/{projectId}/prs',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Create pull request for ticket
     * @param ticketId
     * @returns any PR created
     * @throws ApiError
     */
    public static postGithubPr(
        ticketId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/github/{ticketId}/pr',
            path: {
                'ticketId': ticketId,
            },
        });
    }
}
