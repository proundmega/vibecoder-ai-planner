import { get, post } from './client'

export function getGithubDiff(ticketId) {
  return get(`/api/v1/tickets/${ticketId}/review/diff`)
}

export function getComments(ticketId, type = 'review') {
  return get(`/api/v1/tickets/${ticketId}/comments?type=${type}`)
}

export function postComment(ticketId, data) {
  return post(`/api/v1/tickets/${ticketId}/comments`, data)
}
