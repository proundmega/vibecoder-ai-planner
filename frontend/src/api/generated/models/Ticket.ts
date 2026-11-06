/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NumericId } from './NumericId';
export type Ticket = {
    id?: NumericId;
    title?: string;
    description?: string | null;
    status?: Ticket.status;
    priority?: Ticket.priority;
    ownerId?: NumericId;
    projectId?: NumericId;
    assigneeId?: string | null;
    assigneeName?: string | null;
    milestoneId?: string | null;
    estimate?: number | null;
    dependsOn?: Array<string>;
    createdAt?: string;
    updatedAt?: string;
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
        CRITICAL = 'critical',
        URGENT = 'urgent',
    }
}

