/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type Ticket = {
    id?: string;
    title?: string;
    description?: string;
    status?: Ticket.status;
    priority?: Ticket.priority;
    owner_id?: string;
    project_id?: string;
    created_at?: string;
    updated_at?: string;
};
export namespace Ticket {
    export enum status {
        BACKLOG = 'backlog',
        IN_PROGRESS = 'in_progress',
        REVIEW = 'review',
        DONE = 'done',
    }
    export enum priority {
        LOW = 'low',
        MEDIUM = 'medium',
        HIGH = 'high',
        URGENT = 'urgent',
    }
}

