import { get, post } from './client'

export function fetchPhases(ticketId) {
  return get(`/api/v1/tickets/${ticketId}/phases/current`)
}

export function fetchAllowedPhases(ticketId) {
  return get(`/api/v1/tickets/${ticketId}/phases/allowed`)
}

export function fetchPhaseHistory(ticketId) {
  return get(`/api/v1/tickets/${ticketId}/phases`)
}

export function transitionPhase(ticketId, targetPhase, metadata = {}, actorType = 'human') {
  return post(`/api/v1/tickets/${ticketId}/phases/transition`, {
    toPhase: targetPhase,
    actorType,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  })
}
