/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ErrorDetailsArray } from './ErrorDetailsArray';
import type { ErrorDetailsObject } from './ErrorDetailsObject';
export type Error = {
    code?: string;
    message?: string;
    details?: (ErrorDetailsObject | ErrorDetailsArray);
};

