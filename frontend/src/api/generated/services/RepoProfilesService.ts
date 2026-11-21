/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NumericId } from '../models/NumericId';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class RepoProfilesService {
    /**
     * Get the active repo profile and version history
     * @param projectId
     * @returns any Active profile, latest profile and versions
     * @throws ApiError
     */
    public static getProjectsRepoProfile(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/repo-profile',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Create a draft repo profile version
     * @param projectId
     * @param requestBody
     * @returns any Draft profile created
     * @throws ApiError
     */
    public static postProjectsRepoProfile(
        projectId: NumericId,
        requestBody: Record<string, any>,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/repo-profile',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Invalid profile`,
            },
        });
    }
    /**
     * List repo profile versions
     * @param projectId
     * @returns any Profile versions
     * @throws ApiError
     */
    public static getProjectsRepoProfileVersions(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/repo-profile/versions',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Detect a repo profile from GitHub manifests
     * @param projectId
     * @returns any Proposed profile and warnings
     * @throws ApiError
     */
    public static postProjectsRepoProfileDetect(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/repo-profile/detect',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Edit a draft repo profile
     * @param projectId
     * @param profileId
     * @returns any Updated draft
     * @throws ApiError
     */
    public static putProjectsRepoProfile(
        projectId: NumericId,
        profileId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/projects/{projectId}/repo-profile/{profileId}',
            path: {
                'projectId': projectId,
                'profileId': profileId,
            },
        });
    }
    /**
     * Activate one repo profile version
     * @param projectId
     * @param profileId
     * @returns any Activated profile
     * @throws ApiError
     */
    public static postProjectsRepoProfileActivate(
        projectId: NumericId,
        profileId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/repo-profile/{profileId}/activate',
            path: {
                'projectId': projectId,
                'profileId': profileId,
            },
        });
    }
    /**
     * Queue a dry-run validation for a profile
     * @param projectId
     * @param profileId
     * @returns any Validation queued
     * @throws ApiError
     */
    public static postProjectsRepoProfileValidate(
        projectId: NumericId,
        profileId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/repo-profile/{profileId}/validate',
            path: {
                'projectId': projectId,
                'profileId': profileId,
            },
            errors: {
                409: `A validation is already queued/running`,
            },
        });
    }
    /**
     * List dry-run validations
     * @param projectId
     * @returns any Validation history
     * @throws ApiError
     */
    public static getProjectsRepoProfileValidations(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/repo-profile/validations',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Get one dry-run validation
     * @param projectId
     * @param validationId
     * @returns any Validation status and result
     * @throws ApiError
     */
    public static getProjectsRepoProfileValidations1(
        projectId: NumericId,
        validationId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/repo-profile/validations/{validationId}',
            path: {
                'projectId': projectId,
                'validationId': validationId,
            },
        });
    }
    /**
     * Get the active repo profile for the agent
     * @param projectId
     * @returns any Active profile or null
     * @throws ApiError
     */
    public static getProjectsRepoProfileAgent(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/repo-profile/agent',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Store a scoped mTLS client certificate/key for repo-profile egress
     * @param projectId
     * @returns any Credential metadata (never the private key)
     * @throws ApiError
     */
    public static postProjectsRepoProfileCredentialsMtls(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/repo-profile/credentials/mtls',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * List repo-profile mTLS client credentials
     * @param projectId
     * @returns any Credential metadata (never private keys)
     * @throws ApiError
     */
    public static getProjectsRepoProfileCredentialsMtls(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/repo-profile/credentials/mtls',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Deactivate a repo-profile mTLS client credential
     * @param projectId
     * @param credentialId
     * @returns any Deactivated credential metadata
     * @throws ApiError
     */
    public static deleteProjectsRepoProfileCredentialsMtls(
        projectId: NumericId,
        credentialId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/projects/{projectId}/repo-profile/credentials/mtls/{credentialId}',
            path: {
                'projectId': projectId,
                'credentialId': credentialId,
            },
        });
    }
    /**
     * Get one exact profile revision's scoped mTLS client material for the agent
     * @param projectId
     * @param profileId
     * @param profileVersion
     * @returns any Client certificate/key material or null
     * @throws ApiError
     */
    public static getProjectsRepoProfileAgentMtls(
        projectId: NumericId,
        profileId: string,
        profileVersion: number,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/repo-profile/agent/mtls',
            path: {
                'projectId': projectId,
            },
            query: {
                'profileId': profileId,
                'profileVersion': profileVersion,
            },
        });
    }
    /**
     * Claim the next queued dry run
     * @param projectId
     * @returns any Claimed validation or null
     * @throws ApiError
     */
    public static postProjectsRepoProfileValidationsClaim(
        projectId: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/repo-profile/validations/claim',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * Report a dry-run validation result
     * @param projectId
     * @param validationId
     * @returns any Finished validation
     * @throws ApiError
     */
    public static postProjectsRepoProfileValidationsFinish(
        projectId: NumericId,
        validationId: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/repo-profile/validations/{validationId}/finish',
            path: {
                'projectId': projectId,
                'validationId': validationId,
            },
        });
    }
}
