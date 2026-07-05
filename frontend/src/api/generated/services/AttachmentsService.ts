/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AttachmentsService {
    /**
     * List attachments for a ticket
     * @param id
     * @returns any Attachments list
     * @throws ApiError
     */
    public static getTicketsAttachments(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tickets/{id}/attachments',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Upload an attachment
     * @param id
     * @param formData
     * @returns any Attachment uploaded
     * @throws ApiError
     */
    public static postTicketsAttachments(
        id: string,
        formData: {
            file?: Blob;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tickets/{id}/attachments',
            path: {
                'id': id,
            },
            formData: formData,
            mediaType: 'multipart/form-data',
        });
    }
    /**
     * Delete an attachment
     * @param id
     * @param attachmentId
     * @returns any Attachment deleted
     * @throws ApiError
     */
    public static deleteTicketsAttachments(
        id: string,
        attachmentId: number,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/tickets/{id}/attachments/{attachmentId}',
            path: {
                'id': id,
                'attachmentId': attachmentId,
            },
        });
    }
}
