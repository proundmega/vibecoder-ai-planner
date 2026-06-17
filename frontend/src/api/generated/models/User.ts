/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type User = {
    id?: string;
    name?: string;
    email?: string;
    role?: User.role;
    isActive?: boolean;
    currentPlan?: string;
    created_at?: string;
    updated_at?: string;
};
export namespace User {
    export enum role {
        USER = 'user',
        MEMBER = 'member',
        PROJECT_ADMIN = 'project_admin',
        SUPER_ADMIN = 'super_admin',
    }
}

