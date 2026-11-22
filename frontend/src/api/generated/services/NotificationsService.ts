/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NumericId } from '../models/NumericId';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class NotificationsService {
    /**
     * List notifications for the current user
     * @param unread
     * @param limit
     * @param offset
     * @returns any Notification rows newest first
     * @throws ApiError
     */
    public static getNotifications(
        unread?: boolean,
        limit?: number,
        offset?: number,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/notifications',
            query: {
                'unread': unread,
                'limit': limit,
                'offset': offset,
            },
        });
    }
    /**
     * Unread notification count for the bell
     * @returns any Unread count
     * @throws ApiError
     */
    public static getNotificationsUnreadCount(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/notifications/unread-count',
        });
    }
    /**
     * Mark every notification read
     * @returns any Number of rows marked read
     * @throws ApiError
     */
    public static postNotificationsReadAll(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/notifications/read-all',
        });
    }
    /**
     * Mark one notification read
     * @param id
     * @returns any Updated notification
     * @throws ApiError
     */
    public static postNotificationsRead(
        id: NumericId,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/notifications/{id}/read',
            path: {
                'id': id,
            },
            errors: {
                404: `Notification not found for this user`,
            },
        });
    }
}
