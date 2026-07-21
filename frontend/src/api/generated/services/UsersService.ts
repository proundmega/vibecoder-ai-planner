/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { User } from '../models/User';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class UsersService {
    /**
     * List users for current project
     * @param role
     * @param search
     * @param page
     * @param perPage
     * @returns any List of users
     * @throws ApiError
     */
    public static getUsers(
        role?: string,
        search?: string,
        page?: number,
        perPage?: number,
    ): CancelablePromise<{
        success?: boolean;
        data?: {
            users?: Array<User>;
        };
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/users',
            query: {
                'role': role,
                'search': search,
                'page': page,
                'perPage': perPage,
            },
            errors: {
                401: `Unauthorized`,
            },
        });
    }
    /**
     * Create a new user
     * @param requestBody
     * @returns any User created
     * @throws ApiError
     */
    public static postUsers(
        requestBody: {
            name: string;
            email: string;
            password: string;
            role?: 'user' | 'member' | 'project_admin' | 'super_admin';
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/users',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Validation error`,
            },
        });
    }
    /**
     * Update user
     * @param id
     * @param requestBody
     * @returns any User updated
     * @throws ApiError
     */
    public static putUsers(
        id: string,
        requestBody?: {
            name?: string;
            is_active?: boolean;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/users/{id}',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                404: `User not found`,
            },
        });
    }
    /**
     * Delete user (soft delete)
     * @param id
     * @returns any User deleted
     * @throws ApiError
     */
    public static deleteUsers(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/users/{id}',
            path: {
                'id': id,
            },
            errors: {
                404: `User not found`,
            },
        });
    }
    /**
     * Toggle user active status
     * @param id
     * @returns any User status toggled
     * @throws ApiError
     */
    public static patchUsersToggleActive(
        id: string,
    ): CancelablePromise<{
        success?: boolean;
        data?: User;
    }> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/users/{id}/toggle-active',
            path: {
                'id': id,
            },
            errors: {
                404: `User not found`,
            },
        });
    }
    /**
     * List all users (super admin only)
     * @param search
     * @param role
     * @param isActive
     * @param page
     * @param perPage
     * @returns any List of all users
     * @throws ApiError
     */
    public static getUsersSuperAdmin(
        search?: string,
        role?: string,
        isActive?: boolean,
        page?: number,
        perPage?: number,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/users/super-admin',
            query: {
                'search': search,
                'role': role,
                'is_active': isActive,
                'page': page,
                'perPage': perPage,
            },
            errors: {
                403: `Forbidden - super admin only`,
            },
        });
    }
    /**
     * Unlock a locked user account (super admin only)
     * @param id
     * @returns any User unlocked successfully
     * @throws ApiError
     */
    public static postUsersUnlock(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/users/{id}/unlock',
            path: {
                'id': id,
            },
            errors: {
                403: `Forbidden - super admin only`,
                404: `User not found`,
            },
        });
    }
}
