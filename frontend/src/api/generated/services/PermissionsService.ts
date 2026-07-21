/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PermissionsService {
    /**
     * Get permissions for a role
     * @param roleName
     * @returns any List of permission codes for the role
     * @throws ApiError
     */
    public static getPermissions(
        roleName: 'user' | 'member' | 'project_admin' | 'super_admin',
    ): CancelablePromise<{
        success?: boolean;
        data?: Array<string>;
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/permissions/{roleName}',
            path: {
                'roleName': roleName,
            },
        });
    }
}
