/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NumericId } from './NumericId';
export type User = {
    id?: NumericId;
    name?: string | null;
    email?: string;
    role?: User.role;
    isActive?: boolean;
    currentPlan?: string;
    userCreatedBy?: string | null;
    createdAt?: string;
    lockedUntil?: string | null;
    loginAttempts?: number;
};
export namespace User {
    export enum role {
        USER = 'user',
        MEMBER = 'member',
        PROJECT_ADMIN = 'project_admin',
        SUPER_ADMIN = 'super_admin',
    }
}

