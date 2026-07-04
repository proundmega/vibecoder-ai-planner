/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class CredentialsService {
    /**
     * List credentials for project
     * @param projectId
     * @returns any List of credentials
     * @throws ApiError
     */
    public static getCredentialsCredentials(
        projectId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/credentials/{projectId}/credentials',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Add credential to project
     * @param projectId
     * @param requestBody
     * @returns any Credential added
     * @throws ApiError
     */
    public static postCredentialsCredentials(
        projectId: string,
        requestBody?: {
            name?: string;
            credential?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/credentials/{projectId}/credentials',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Update credential
     * @param projectId
     * @param credentialId
     * @param requestBody
     * @returns any Credential updated
     * @throws ApiError
     */
    public static patchCredentialsCredentials(
        projectId: string,
        credentialId: string,
        requestBody?: {
            name?: string;
            credential?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/credentials/{projectId}/credentials/{credentialId}',
            path: {
                'projectId': projectId,
                'credentialId': credentialId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete (deactivate) credential
     * @param projectId
     * @param credentialId
     * @returns any Credential deleted
     * @throws ApiError
     */
    public static deleteCredentialsCredentials(
        projectId: string,
        credentialId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/credentials/{projectId}/credentials/{credentialId}',
            path: {
                'projectId': projectId,
                'credentialId': credentialId,
            },
        });
    }
    /**
     * Rotate credential
     * @param projectId
     * @param credentialId
     * @returns any Credential rotated
     * @throws ApiError
     */
    public static postCredentialsCredentialsRotate(
        projectId: string,
        credentialId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/credentials/{projectId}/credentials/{credentialId}/rotate',
            path: {
                'projectId': projectId,
                'credentialId': credentialId,
            },
        });
    }
    /**
     * Get decrypted key for agent use
     * @param projectId
     * @returns any Decrypted key
     * @throws ApiError
     */
    public static getCredentialsCredentialsDecrypt(
        projectId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/credentials/{projectId}/credentials/decrypt',
            path: {
                'projectId': projectId,
            },
        });
    }
}
