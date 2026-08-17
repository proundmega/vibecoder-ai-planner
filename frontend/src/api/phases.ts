import { get, post } from './client'

export interface Phase {
  id: string
  ticket_id: string
  name: string
  status: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface AllowedPhase {
  name: string
  label: string
}

export interface PhaseTransitionResult {
  ticketId: string
  fromPhase: string
  toPhase: string
  status: string
}

export function fetchPhases(ticketId: string): Promise<{ phase: string }> {
  return get(`/api/v1/tickets/${ticketId}/phases/current`)
}

export function fetchAllowedPhases(ticketId: string): Promise<{ allowed: AllowedPhase[] }> {
  return get(`/api/v1/tickets/${ticketId}/phases/allowed`)
}

export function fetchPhaseHistory(ticketId: string): Promise<Phase[]> {
  return get(`/api/v1/tickets/${ticketId}/phases`)
}

export function transitionPhase(ticketId: string, targetPhase: string, metadata: Record<string, unknown> = {}, actorType: string = 'human'): Promise<PhaseTransitionResult> {
  return post(`/api/v1/tickets/${ticketId}/phases/transition`, {
    toPhase: targetPhase,
    actorType,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  })
}
